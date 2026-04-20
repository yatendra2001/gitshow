import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { D1Adapter } from "@auth/d1-adapter";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import authConfig from "./auth.config";

/**
 * Full Auth.js setup. Wrapped in a factory because `getCloudflareContext()`
 * isn't available at module load time during SSG — it needs the per-request
 * async context that OpenNext establishes in its worker.
 *
 * Session strategy: database — sessions live in D1's `sessions` table via
 * @auth/d1-adapter. Keep the schema matching its expectations exactly
 * (migration 0003 rebuilt accounts + sessions; any future change there
 * should be another migration).
 *
 * Adapter wrapper logs method enter/exit so auth bugs are visible in
 * `wrangler tail`, but redacts OAuth tokens + any other secret-looking
 * fields so we never leak bearer tokens into Cloudflare observability.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const { env } = await getCloudflareContext({ async: true });
  const baseAdapter = D1Adapter(env.DB);

  return {
    ...authConfig,
    adapter: wrapAdapterWithLogging(
      baseAdapter as unknown as Record<string, unknown>,
    ) as typeof baseAdapter,
    session: { strategy: "database" },
    secret: env.AUTH_SECRET,
    providers: [
      GitHub({
        clientId: env.AUTH_GITHUB_ID,
        clientSecret: env.AUTH_GITHUB_SECRET,
        authorization: {
          params: {
            scope: "read:user user:email repo",
          },
        },
      }),
    ],
    trustHost: true,
    callbacks: {
      /**
       * Runs on every sign-in. The D1 adapter has already upserted the
       * users row at this point (default columns: id, name, email,
       * emailVerified, image). We fold in the GitHub login — which
       * lives on the raw provider profile — and stash it in the new
       * users.login column so the rest of the app can display
       * @yatendra2001 instead of the display name.
       */
      async signIn({ user, account, profile }) {
        try {
          const login = (profile as { login?: unknown })?.login;
          if (
            user?.id &&
            account?.provider === "github" &&
            typeof login === "string" &&
            login.length > 0
          ) {
            await env.DB.prepare(
              `UPDATE users SET login = ? WHERE id = ?`,
            )
              .bind(login, user.id)
              .run();
          }
        } catch (err) {
          console.error("[auth.signIn.updateLogin]", err);
          // Don't block sign-in on a login-persist failure — the user
          // still gets in; next sign-in will retry the UPDATE.
        }
        return true;
      },
      /**
       * Project the users.login column onto session.user so server
       * components can read `session.user.login` with proper typing.
       */
      async session({ session, user }) {
        if (session.user && user?.id) {
          try {
            const row = await env.DB.prepare(
              `SELECT login FROM users WHERE id = ? LIMIT 1`,
            )
              .bind(user.id)
              .first<{ login: string | null }>();
            if (row?.login) {
              (session.user as { login?: string }).login = row.login;
            }
          } catch (err) {
            console.error("[auth.session.fetchLogin]", err);
          }
        }
        return session;
      },
    },
    // NextAuth's own `debug` writes full payloads including tokens.
    // Keep off unless actively debugging — events below cover what we
    // usually care about (without the secrets).
    debug: false,
    logger: {
      error(err: unknown) {
        console.error("[auth.error]", err);
      },
      warn(code: string) {
        console.warn("[auth.warn]", code);
      },
      // no-op debug; the adapter wrapper provides the useful calls.
      debug() {},
    },
    events: {
      createUser({ user }) {
        console.log("[auth.createUser]", { id: user.id, email: user.email });
      },
      linkAccount({ user, account }) {
        console.log("[auth.linkAccount]", {
          userId: user.id,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        });
      },
      signIn({ user, isNewUser }) {
        console.log("[auth.signIn]", { id: user.id, isNewUser });
      },
    },
  };
});

/**
 * Proxy every adapter method with enter/ok/threw logging. Sensitive
 * fields are redacted before JSON serialization — the adapter's
 * linkAccount input carries `access_token` + `id_token` + `refresh_token`
 * which we must NEVER write to logs.
 */
function wrapAdapterWithLogging<T extends Record<string, unknown>>(
  adapter: T,
): T {
  if (!adapter) return adapter;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(adapter)) {
    if (typeof value !== "function") {
      out[key] = value;
      continue;
    }
    out[key] = async (...args: unknown[]) => {
      const tag = `[adapter.${key}]`;
      try {
        console.log(tag, "enter", safeJson(args));
        const result = await (value as (...a: unknown[]) => unknown)(...args);
        console.log(tag, "ok", safeJson(result));
        return result;
      } catch (err) {
        console.error(tag, "THREW", {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          cause:
            err instanceof Error
              ? (err as { cause?: unknown }).cause
              : undefined,
        });
        throw err;
      }
    };
  }
  return out as T;
}

/** Fields that must never leave the worker in plaintext. */
const REDACT_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "oauth_token",
  "oauth_token_secret",
  "session_state",
  "code_verifier",
  "AUTH_SECRET",
  "AUTH_GITHUB_SECRET",
  "CF_API_TOKEN",
  "FLY_API_TOKEN",
  "OPENROUTER_API_KEY",
  "GH_TOKEN",
  "R2_SECRET_ACCESS_KEY",
  "PIPELINE_SHARED_SECRET",
]);

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (key, val) => {
        if (REDACT_KEYS.has(key) && typeof val === "string" && val.length > 0) {
          return `<redacted:${val.length}>`;
        }
        if (typeof val === "string" && val.length > 200) {
          return val.slice(0, 200) + "…";
        }
        return val;
      },
    ).slice(0, 800);
  } catch {
    return "<unserializable>";
  }
}
