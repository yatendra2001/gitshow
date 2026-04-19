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
 * GitHub provider uses the `repo` scope so the pipeline can fetch private
 * repos the user wants analyzed. Users who don't grant it can still sign
 * in — the pipeline quietly skips private-repo discovery.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const { env } = await getCloudflareContext({ async: true });
  return {
    ...authConfig,
    adapter: D1Adapter(env.DB),
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
  };
});
