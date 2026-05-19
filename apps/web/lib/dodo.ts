import DodoPayments from "dodopayments";

/**
 * Shared Dodo Payments REST client.
 *
 * `auth.ts` builds its own client inside the Better Auth plugin init
 * (it has to — the plugin owns checkout/portal/webhook). Everything
 * else that needs to *read* Dodo state on the request path
 * (reconciliation cron, the on-read resync on /app/billing, the
 * webhook customer→user fallback) goes through here so we construct
 * the client one consistent way.
 *
 * Returns `null` when the API key is absent rather than throwing —
 * callers are all best-effort safety nets (the webhook/portal paths
 * keep working without them), so a missing key should degrade to
 * "skip the extra sync", never 500 a page or a cron.
 */
export function getDodoClient(env: CloudflareEnv): DodoPayments | null {
  if (!env.DODO_PAYMENTS_API_KEY) return null;
  return new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_PAYMENTS_ENVIRONMENT ?? "test_mode",
  });
}

export type DodoClient = DodoPayments;
