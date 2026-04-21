/**
 * Read the user's GitHub OAuth access token from Better Auth's
 * `account` table.
 *
 * Every authenticated API route that spawns a Fly machine should use
 * this — the bot `GH_TOKEN` secret only sees public data, whereas the
 * per-user token gives us access to private + org repos they've
 * authorized. The `repo` OAuth scope is already requested in auth.ts.
 *
 * If the user revoked the app on GitHub since signing in, `gh api`
 * will 401 and the scan will fail loudly. That's better than silently
 * downgrading to public-only reads.
 *
 * Column naming is Better Auth's singular/camelCase convention:
 * `account.userId`, `account.providerId`, `account.accessToken`
 * (migration 0006).
 */

export async function getUserGitHubToken(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT accessToken FROM account
         WHERE userId = ? AND providerId = 'github' AND accessToken IS NOT NULL
         ORDER BY updatedAt DESC
         LIMIT 1`,
    )
    .bind(userId)
    .first<{ accessToken: string | null }>();
  return row?.accessToken ?? null;
}
