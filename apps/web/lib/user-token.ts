/**
 * Read the user's GitHub OAuth access_token from the accounts table.
 *
 * Every authenticated API route that spawns a Fly machine should use
 * this — the bot `GH_TOKEN` secret only sees public data, whereas the
 * per-user token gives us access to private + org repos they've
 * authorized. The `repo` OAuth scope is already requested in auth.ts.
 *
 * If the user revoked the app on GitHub since signing in, `gh api`
 * will 401 and the scan will fail loudly. That's better than silently
 * downgrading to public-only reads.
 */

export async function getUserGitHubToken(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT access_token FROM accounts
         WHERE userId = ? AND provider = 'github' AND access_token IS NOT NULL
         ORDER BY rowid DESC
         LIMIT 1`,
    )
    .bind(userId)
    .first<{ access_token: string | null }>();
  return row?.access_token ?? null;
}
