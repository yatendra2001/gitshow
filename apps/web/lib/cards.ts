/**
 * ProfileCard loaders. The web app reads the slim `14-card.json` that the
 * Fly pipeline writes into R2 at `scans/{scan_id}/14-card.json`.
 *
 * Two call sites:
 *   - `getDemoCard()` — used by /s/demo and /p/demo, ships a seeded copy
 *     of yatendra2001's card so the page always has something to render
 *     without hitting R2 or the pipeline.
 *   - `getScanCard(scanId)` — reads R2 via the native `env.BUCKET`
 *     binding. Returns null when the scan hasn't finished yet.
 */
import type { ProfileCard } from "@gitshow/shared/schemas";
import demoCardJson from "./demo-card.json";

/**
 * The bundled demo card. Typed as ProfileCard so the component signature
 * stays honest across the code path.
 */
export function getDemoCard(): ProfileCard {
  return demoCardJson as unknown as ProfileCard;
}

/**
 * Read a live scan's card from R2. Returns null if the object doesn't
 * exist yet (scan in flight) or we can't access the bucket.
 */
export async function getScanCard(
  scanId: string,
  bucket: R2Bucket,
): Promise<ProfileCard | null> {
  try {
    const obj = await bucket.get(`scans/${scanId}/14-card.json`);
    if (!obj) return null;
    const raw = await obj.text();
    return JSON.parse(raw) as ProfileCard;
  } catch {
    return null;
  }
}

/**
 * Overlay user-edited claim text onto a card. The R2 `14-card.json`
 * is frozen at scan completion; every post-scan edit lives in the D1
 * `claims` table with status=user_edited. Merging at read time means
 * we don't have to re-emit the R2 card on every edit — the card in
 * R2 stays the snapshot, D1 is the current truth.
 *
 * Mutates nothing; returns a new card with the text swapped where an
 * edit exists.
 */
export async function mergeUserEdits(
  card: ProfileCard,
  scanId: string,
  db: D1Database,
): Promise<ProfileCard> {
  try {
    const resp = await db
      .prepare(
        `SELECT id, text FROM claims
           WHERE scan_id = ? AND status = 'user_edited'`,
      )
      .bind(scanId)
      .all<{ id: string; text: string }>();
    const edits = new Map<string, string>();
    for (const row of resp.results ?? []) {
      edits.set(row.id, row.text);
    }
    if (edits.size === 0) return card;
    const swap = (c: ProfileCard["hook"]) =>
      c && edits.has(c.id) ? { ...c, text: edits.get(c.id)! } : c;
    return {
      ...card,
      hook: swap(card.hook),
      numbers: card.numbers.map((n) => swap(n)!),
      patterns: card.patterns.map((p) => swap(p)!),
      shipped: card.shipped.map((s) => swap(s)!),
      disclosure: swap(card.disclosure),
    };
  } catch {
    return card;
  }
}

/**
 * Read a card by public handle. Convention: the web app points the
 * `HANDLE → latest scan_id` lookup at D1 first, then reads R2 by scan id.
 * Until the lookup is wired up, `/p/[handle]` with handle === demo handle
 * serves the bundled demo.
 */
export async function getPublicCardByHandle(
  handle: string,
  env: CloudflareEnv,
): Promise<ProfileCard | null> {
  if (handle === (env.DEMO_HANDLE ?? "yatendra2001")) {
    return getDemoCard();
  }
  // Resolve latest successful scan id for this handle.
  const row = await env.DB.prepare(
    `SELECT id FROM scans
       WHERE handle = ? AND status = 'succeeded'
       ORDER BY completed_at DESC LIMIT 1`,
  )
    .bind(handle)
    .first<{ id: string }>();
  if (!row) return null;
  return getScanCard(row.id, env.BUCKET);
}
