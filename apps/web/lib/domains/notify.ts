/**
 * Activation notification hook.
 *
 * Called from /api/domains/verify and /api/cron/domains-recheck after
 * a state transition. Fires the "your domain is live" email exactly
 * once per activation moment — i.e. when prev !== 'active' and
 * next === 'active'. If the user disconnects and re-connects, they get
 * a new email (different activation event); if the cron observes
 * `active → active` (no transition), nothing fires.
 *
 * Best-effort: errors are swallowed and logged (via console.warn so it
 * surfaces in Workers tail). The dashboard timeline is the source of
 * truth for "live" — the email is a courtesy.
 *
 * Why a separate file vs inlining: keeps repo.ts pure DB ops, and the
 * email is the only side-effect that fans out from a status change.
 * If we add Slack / Discord / push notifications later they can hook
 * here too.
 */

import type { D1Database } from "@cloudflare/workers-types";
import {
  loadActivationContext,
  sendDomainLiveEmail,
} from "./email";
import type { DomainStatus } from "./repo";

export interface ActivationNotifyInput {
  domainId: string;
  prevStatus: DomainStatus | null | undefined;
  nextStatus: DomainStatus;
}

/**
 * Returns true if an email was queued (Resend accepted it), false
 * otherwise. Caller can fire-and-forget: this never throws.
 */
export async function notifyDomainActivatedIfTransitioned(
  env: CloudflareEnv,
  db: D1Database,
  input: ActivationNotifyInput,
): Promise<boolean> {
  if (input.nextStatus !== "active") return false;
  if (input.prevStatus === "active") return false; // no real transition

  try {
    const ctx = await loadActivationContext(db, input.domainId);
    if (!ctx) return false;
    return await sendDomainLiveEmail(env, {
      to: ctx.email,
      hostname: ctx.hostname,
      slug: ctx.slug,
      firstName: ctx.firstName,
    });
  } catch (err) {
    // Best-effort: never fail a status update because the email
    // pipeline is misbehaving.
    console.warn(
      `[domains/notify] activation email failed for ${input.domainId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
