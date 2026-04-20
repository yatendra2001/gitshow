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
 * Reconcile a card against the live D1 `claims` table.
 *
 *   - user_edited  → swap the text onto the card
 *   - hard-deleted → drop the claim from the card entirely
 *
 * The R2 `14-card.json` is frozen at scan completion; D1 is the
 * current source of truth for what the user wants to keep. Merging
 * at read time means we don't have to re-emit the R2 card on every
 * edit or delete.
 *
 * Mutates nothing; returns a new card.
 */
export async function mergeUserEdits(
  card: ProfileCard,
  scanId: string,
  db: D1Database,
): Promise<ProfileCard> {
  try {
    const resp = await db
      .prepare(`SELECT id, text, status FROM claims WHERE scan_id = ?`)
      .bind(scanId)
      .all<{ id: string; text: string; status: string }>();
    const live = new Map<string, { text: string; status: string }>();
    for (const row of resp.results ?? []) {
      live.set(row.id, { text: row.text, status: row.status });
    }
    // If D1 has no rows at all (very old scan pre-dating the claims
    // upsert), fall back to the card as-is so the user doesn't see a
    // nuked profile.
    if (live.size === 0) return card;

    const applyEdit = (c: ProfileCard["hook"]) => {
      if (!c) return c;
      const row = live.get(c.id);
      if (!row) return null; // deleted from D1 → drop
      if (row.status === "user_edited") {
        return { ...c, text: row.text };
      }
      return c;
    };
    const filterList = <T extends { id: string }>(
      list: T[],
    ): T[] =>
      list
        .map((c) => applyEdit(c as unknown as ProfileCard["hook"]) as T | null)
        .filter((c): c is T => c !== null);

    return {
      ...card,
      hook: applyEdit(card.hook) ?? null,
      numbers: filterList(card.numbers),
      patterns: filterList(card.patterns),
      shipped: filterList(card.shipped),
      disclosure: applyEdit(card.disclosure) ?? null,
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
