/**
 * Update Dodo Payments product prices for test or live mode.
 *
 * Usage:
 *   bun scripts/update-dodo-prices.ts          # test mode (uses DODO_PAYMENTS_API_KEY)
 *   bun scripts/update-dodo-prices.ts --live   # live mode (uses DODO_LIVE_PAYMENTS_API_KEY)
 *
 * Behavior:
 *   - Reads the appropriate API key from apps/web/.dev.vars.
 *   - For each product (Pro Monthly, Pro Yearly):
 *       - If a product with that name exists → update its price in place.
 *       - If it doesn't → create it at the new price.
 *   - For live mode only: also creates the webhook endpoint pointing at
 *     https://gitshow.io/api/auth/dodopayments/webhooks (idempotent),
 *     retrieves the signing secret, and prints `wrangler secret put`
 *     commands for the four prod secrets.
 *
 * Idempotent. Existing subscriptions stay on their old price (Dodo
 * doesn't retroactively reprice subscribers); only new checkouts use
 * the updated price.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import DodoPayments from "dodopayments";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const devVarsPath = resolve(webRoot, ".dev.vars");

const LIVE = process.argv.includes("--live");
const ENVIRONMENT = LIVE ? "live_mode" : "test_mode";
const KEY_VAR = LIVE ? "DODO_LIVE_PAYMENTS_API_KEY" : "DODO_PAYMENTS_API_KEY";
const WEBHOOK_URL = "https://gitshow.io/api/auth/dodopayments/webhooks";

const MONTHLY = { name: "Pro Monthly", priceCents: 1000, interval: "Month" as const };
const YEARLY = { name: "Pro Yearly", priceCents: 8400, interval: "Year" as const };

const SUBSCRIPTION_EVENTS = [
  "subscription.active",
  "subscription.updated",
  "subscription.on_hold",
  "subscription.renewed",
  "subscription.plan_changed",
  "subscription.cancelled",
  "subscription.failed",
  "subscription.expired",
];

function parseDevVars(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function buildPrice(priceCents: number, interval: "Month" | "Year") {
  return {
    type: "recurring_price" as const,
    currency: "USD" as const,
    price: priceCents,
    discount: 0,
    purchasing_power_parity: false,
    payment_frequency_count: 1,
    payment_frequency_interval: interval,
    subscription_period_count: 1,
    subscription_period_interval: interval,
  };
}

async function upsertProduct(
  client: DodoPayments,
  name: string,
  priceCents: number,
  interval: "Month" | "Year",
): Promise<{ id: string; action: "updated" | "created" | "unchanged" }> {
  const list = await client.products.list({ recurring: true });
  for await (const p of list) {
    if (p.name !== name) continue;
    const currentCents =
      p.price_detail && "price" in p.price_detail
        ? (p.price_detail as { price: number }).price
        : null;
    if (currentCents === priceCents) {
      console.log(`  ✓ ${name} (${p.product_id}) already at ${priceCents} cents — no change`);
      return { id: p.product_id, action: "unchanged" };
    }
    await client.products.update(p.product_id, {
      price: buildPrice(priceCents, interval),
    });
    console.log(
      `  ↻ ${name} (${p.product_id}): ${currentCents ?? "?"} → ${priceCents} cents`,
    );
    return { id: p.product_id, action: "updated" };
  }
  const created = await client.products.create({
    name,
    tax_category: "saas",
    price: buildPrice(priceCents, interval),
  });
  console.log(`  + Created ${name}: ${created.product_id} at ${priceCents} cents`);
  return { id: created.product_id, action: "created" };
}

async function findOrCreateWebhook(client: DodoPayments, url: string): Promise<string> {
  const list = await client.webhooks.list({ limit: 100 });
  const existing = list.data?.find((w: { url: string }) => w.url === url);
  if (existing) {
    console.log(`  ✓ Webhook already exists: ${existing.id}`);
    return existing.id;
  }
  const created = await client.webhooks.create({
    url,
    filter_types: SUBSCRIPTION_EVENTS as never,
    description: "GitShow billing sync",
  });
  console.log(`  + Created webhook: ${created.id}`);
  return created.id;
}

async function main() {
  const env = { ...parseDevVars(devVarsPath), ...process.env };
  const apiKey = env[KEY_VAR];
  if (!apiKey) {
    console.error(`${KEY_VAR} not found in .dev.vars or environment.`);
    process.exit(1);
  }

  console.log(`Dodo prices — ${ENVIRONMENT}`);
  console.log(`Target: $${MONTHLY.priceCents / 100}/mo, $${YEARLY.priceCents / 100}/yr\n`);

  const client = new DodoPayments({ bearerToken: apiKey, environment: ENVIRONMENT });

  console.log("Products:");
  const monthly = await upsertProduct(client, MONTHLY.name, MONTHLY.priceCents, MONTHLY.interval);
  const yearly = await upsertProduct(client, YEARLY.name, YEARLY.priceCents, YEARLY.interval);

  let webhookId: string | null = null;
  let webhookSecret: string | null = null;
  if (LIVE) {
    console.log("\nWebhook:");
    webhookId = await findOrCreateWebhook(client, WEBHOOK_URL);
    const secret = await client.webhooks.retrieveSecret(webhookId);
    webhookSecret = secret.secret;
  }

  console.log("\n" + "─".repeat(60));
  console.log(`Mode: ${ENVIRONMENT}`);
  console.log(`  Monthly: ${monthly.id} (${monthly.action})`);
  console.log(`  Yearly:  ${yearly.id} (${yearly.action})`);

  if (LIVE && webhookSecret) {
    console.log(`  Webhook: ${webhookId}`);
    console.log("\nNext step — push these as Cloudflare Worker secrets from apps/web/:\n");
    console.log("  cd apps/web");
    console.log(`  echo "live_mode" | bunx wrangler secret put DODO_PAYMENTS_ENVIRONMENT`);
    console.log(`  echo "${apiKey}" | bunx wrangler secret put DODO_PAYMENTS_API_KEY`);
    console.log(`  echo "${webhookSecret}" | bunx wrangler secret put DODO_PAYMENTS_WEBHOOK_SECRET`);
    console.log(`  echo "${monthly.id}" | bunx wrangler secret put DODO_PRODUCT_ID_MONTHLY`);
    console.log(`  echo "${yearly.id}" | bunx wrangler secret put DODO_PRODUCT_ID_YEARLY`);
    console.log(
      "\nNote: DODO_PAYMENTS_ENVIRONMENT is currently a 'var' in wrangler.jsonc.",
    );
    console.log(
      "Putting it as a secret takes precedence at runtime; alternatively edit",
    );
    console.log(`wrangler.jsonc to "live_mode" and merge to main (auto-deploys).`);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
