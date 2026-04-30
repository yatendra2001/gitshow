/**
 * Bootstrap Dodo Payments resources for test or live mode.
 *
 * Usage:
 *   bun scripts/bootstrap-dodo.ts                # test_mode (default)
 *   bun scripts/bootstrap-dodo.ts --live         # live_mode
 *
 * Reads DODO_PAYMENTS_API_KEY from .dev.vars (or process.env). Creates
 * two subscription products (Pro Monthly $10/mo, Pro Yearly $84/yr)
 * and one webhook endpoint pointing at the public worker URL, then
 * fetches the webhook signing secret and writes all four resulting
 * values back into .dev.vars.
 *
 * Idempotent: re-running matches existing products by name and
 * existing webhooks by URL, skipping creation if they already exist.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import DodoPayments from "dodopayments";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const devVarsPath = resolve(webRoot, ".dev.vars");

const LIVE = process.argv.includes("--live");
const ENVIRONMENT = LIVE ? "live_mode" : "test_mode";
const WEBHOOK_URL = "https://gitshow.io/api/auth/dodopayments/webhooks";

const MONTHLY_NAME = "Pro Monthly";
const YEARLY_NAME = "Pro Yearly";

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
  const text = readFileSync(path, "utf8");
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function setDevVar(key: string, value: string): void {
  let text = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}="${value}"`;
  if (re.test(text)) {
    text = text.replace(re, line);
  } else {
    if (text && !text.endsWith("\n")) text += "\n";
    text += `${line}\n`;
  }
  writeFileSync(devVarsPath, text);
}

async function findOrCreateProduct(
  client: DodoPayments,
  name: string,
  priceCents: number,
  interval: "Month" | "Year",
): Promise<string> {
  const existing = await client.products.list({ recurring: true });
  for await (const p of existing) {
    if (p.name === name) {
      console.log(`  ✓ ${name} already exists: ${p.product_id}`);
      return p.product_id;
    }
  }
  const created = await client.products.create({
    name,
    tax_category: "saas",
    price: {
      type: "recurring_price",
      currency: "USD",
      price: priceCents,
      discount: 0,
      purchasing_power_parity: false,
      payment_frequency_count: 1,
      payment_frequency_interval: interval,
      subscription_period_count: 1,
      subscription_period_interval: interval,
    },
  });
  console.log(`  + Created ${name}: ${created.product_id}`);
  return created.product_id;
}

async function findOrCreateWebhook(
  client: DodoPayments,
  url: string,
): Promise<string> {
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
  const apiKey = env.DODO_PAYMENTS_API_KEY;
  if (!apiKey) {
    console.error(
      "DODO_PAYMENTS_API_KEY not found in .dev.vars or environment.",
    );
    process.exit(1);
  }

  console.log(`Dodo bootstrap — ${ENVIRONMENT}`);
  console.log(`Webhook target: ${WEBHOOK_URL}\n`);

  const client = new DodoPayments({
    bearerToken: apiKey,
    environment: ENVIRONMENT,
  });

  console.log("Products:");
  const monthlyId = await findOrCreateProduct(client, MONTHLY_NAME, 1000, "Month");
  const yearlyId = await findOrCreateProduct(client, YEARLY_NAME, 8400, "Year");

  console.log("\nWebhook:");
  const webhookId = await findOrCreateWebhook(client, WEBHOOK_URL);
  const secret = await client.webhooks.retrieveSecret(webhookId);
  const webhookSecret = secret.secret;

  console.log("\nWriting values into .dev.vars...");
  setDevVar("DODO_PRODUCT_ID_MONTHLY", monthlyId);
  setDevVar("DODO_PRODUCT_ID_YEARLY", yearlyId);
  setDevVar("DODO_PAYMENTS_WEBHOOK_SECRET", webhookSecret);

  console.log("\nDone. Values written:");
  console.log(`  DODO_PRODUCT_ID_MONTHLY=${monthlyId}`);
  console.log(`  DODO_PRODUCT_ID_YEARLY=${yearlyId}`);
  console.log(`  DODO_PAYMENTS_WEBHOOK_SECRET=${webhookSecret.slice(0, 8)}…`);
  if (LIVE) {
    console.log("\nFor production, flip DODO_PAYMENTS_ENVIRONMENT in");
    console.log("wrangler.jsonc to \"live_mode\" and run:");
    console.log("  wrangler secret put DODO_PAYMENTS_API_KEY");
    console.log("  wrangler secret put DODO_PAYMENTS_WEBHOOK_SECRET");
    console.log("  wrangler secret put DODO_PRODUCT_ID_MONTHLY");
    console.log("  wrangler secret put DODO_PRODUCT_ID_YEARLY");
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
