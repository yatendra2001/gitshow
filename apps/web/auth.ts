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
 * Session strategy: database. KV-backed would be faster but we already own
 * D1, one less moving part.
 *
 * Verbose logging is ON so we can trace what the adapter does during
 * OAuth callback. Silent swallowed errors are how we got here — don't
 * remove the loggers without a concrete reason.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const { env } = await getCloudflareContext({ async: true });
  const baseAdapter = D1Adapter(env.DB);

  return {
    ...authConfig,
    adapter: wrapAdapterWithLogging(baseAdapter as unknown as Record<string, unknown>) as typeof baseAdapter,
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
    debug: true,
    logger: {
      error(err: unknown) {
        console.error("[auth.logger.error]", err);
      },
      warn(code: string) {
        console.warn("[auth.logger.warn]", code);
      },
      debug(code: string, meta: unknown) {
        console.log("[auth.logger.debug]", code, meta);
      },
    },
    events: {
      signIn(message) {
        console.log("[auth.event.signIn]", JSON.stringify(message));
      },
      createUser(message) {
        console.log("[auth.event.createUser]", JSON.stringify(message));
      },
      linkAccount(message) {
        console.log("[auth.event.linkAccount]", JSON.stringify(message));
      },
      session(message) {
        console.log("[auth.event.session]", JSON.stringify(message));
      },
    },
  };
});

/**
 * Wraps every adapter method so thrown errors AND successful calls are
 * visible in `wrangler tail`. The base @auth/d1-adapter catches + silently
 * logs via console.error in some paths — which Cloudflare Workers chops
 * before it reaches our tail — so we log aggressively on entry + exit.
 */
function wrapAdapterWithLogging<T extends Record<string, unknown>>(adapter: T): T {
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
          cause: err instanceof Error ? (err as { cause?: unknown }).cause : undefined,
        });
        throw err;
      }
    };
  }
  return out as T;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) =>
        typeof val === "string" && val.length > 200
          ? val.slice(0, 200) + "…"
          : val,
    ).slice(0, 800);
  } catch {
    return "<unserializable>";
  }
}
