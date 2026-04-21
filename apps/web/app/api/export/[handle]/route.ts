import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { getProfileBySlug } from "@/lib/profiles";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";

/**
 * GET /api/export/[handle]?format=html|json
 *
 * Returns a print-optimized single-page HTML that the browser can
 * Save-as-PDF with high fidelity (via @page CSS). For JSON we just
 * serve the raw ProfileCard.
 *
 * A fully bespoke PDF layout (matching our polished web card in a
 * custom binary) is a larger lift — would land behind Cloudflare
 * Browser Rendering or a separate Fly worker pipeline. This route
 * ships the user-facing export now and doesn't block on that.
 */

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "html";

  const { env } = await getCloudflareContext({ async: true });
  const data = await getProfileBySlug(env.DB, env.BUCKET, handle);
  if (!data) notFound();

  if (format === "json") {
    return new Response(JSON.stringify(data.card, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${handle}.json"`,
      },
    });
  }

  const html = renderPrintable(data.card);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${handle}.html"`,
    },
  });
}

function renderPrintable(card: ProfileCard): string {
  const hook = card.hook?.text ?? `@${card.handle}`;
  const numbers = card.numbers.slice(0, 3);
  const patterns = card.patterns.slice(0, 3);
  const shipped = card.shipped.slice(0, 6);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>@${esc(card.handle)} · gitshow</title>
  <style>
    @page { size: Letter; margin: 18mm 16mm; }
    :root {
      --ink: #0F172A;
      --mute: #64748B;
      --line: #E2E8F0;
      --tint: #F8FAFC;
      --accent: #3B82F6;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: #fff;
      color: var(--ink);
      font-family: -apple-system, "Plus Jakarta Sans", system-ui, Segoe UI, Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.55;
    }
    body {
      max-width: 760px;
      margin: 0 auto;
      padding: 28px 32px;
    }
    header .eyebrow {
      font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--mute); margin-bottom: 6px;
    }
    h1 {
      font-family: "Instrument Serif", Georgia, serif;
      font-size: 30px; line-height: 1.15;
      margin: 0 0 22px;
      font-weight: 400;
    }
    .kpis {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      margin-bottom: 22px;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .kpi .big {
      font-family: "Instrument Serif", Georgia, serif;
      font-size: 34px; line-height: 1; margin-bottom: 4px;
    }
    .kpi .sub {
      color: var(--ink); font-size: 11.5px; margin-bottom: 6px;
    }
    .kpi .why {
      color: var(--mute); font-size: 10.5px; line-height: 1.45;
    }
    h2 {
      font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--mute); margin: 18px 0 8px;
      font-weight: 600;
    }
    .insights {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      margin-bottom: 22px;
    }
    .insight {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 11.5px;
    }
    .insight strong { font-size: 13px; display: block; margin-bottom: 4px; }
    .shipped { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
    .shipped .row {
      display: flex; align-items: baseline; gap: 8px;
      padding: 8px 10px; border-radius: 8px; background: var(--tint);
      font-size: 11.5px;
    }
    .shipped .row .name { font-family: Menlo, Monaco, monospace; color: var(--mute); font-size: 10.5px; }
    .disclosure {
      border-left: 3px solid var(--accent);
      padding: 10px 14px;
      background: var(--tint);
      border-radius: 6px;
      font-size: 12px;
      margin-top: 12px;
    }
    footer {
      margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line);
      font-size: 10.5px; color: var(--mute);
      display: flex; justify-content: space-between;
    }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">@${esc(card.handle)}${card.primary_shape ? " · " + esc(card.primary_shape) : ""}</div>
    <h1>${esc(hook)}</h1>
  </header>

  ${numbers.length ? `
  <section class="kpis">
    ${numbers.map((c) => renderKpi(c)).join("")}
  </section>
  ` : ""}

  ${patterns.length ? `
  <h2>Things to know</h2>
  <section class="insights">
    ${patterns.map((c) => renderInsight(c)).join("")}
  </section>
  ` : ""}

  ${shipped.length ? `
  <h2>Shipped</h2>
  <section class="shipped">
    ${shipped.map((c) => renderShipped(c)).join("")}
  </section>
  ` : ""}

  ${card.disclosure ? `
  <h2>Working on</h2>
  <div class="disclosure">${esc(trim2(card.disclosure.text))}</div>
  ` : ""}

  <footer>
    <span>generated ${esc(new Date(card.generated_at).toLocaleDateString())}</span>
    <span>gitshow.io/${esc(card.handle)}</span>
  </footer>
</body>
</html>`;
}

function renderKpi(c: CardClaim): string {
  const { big, small } = splitBigSmall(c.label);
  return `<div class="kpi">
    <div class="big">${esc(big)}</div>
    <div class="sub">${esc(small || c.sublabel || "")}</div>
    <div class="why">${esc(firstWords(strip(c.text), 12))}</div>
  </div>`;
}

function renderInsight(c: CardClaim): string {
  return `<div class="insight">
    ${c.label ? `<strong>${esc(c.label)}</strong>` : ""}
    ${esc(firstWords(strip(c.text), 30))}
  </div>`;
}

function renderShipped(c: CardClaim): string {
  return `<div class="row">
    <span class="name">${esc(c.label ?? "")}</span>
    <span>${esc(firstWords(strip(c.text), 22))}</span>
  </div>`;
}

function splitBigSmall(label?: string): { big: string; small: string } {
  if (!label) return { big: "·", small: "" };
  const m = label.match(/^([\d,.+~kmKM]+)\s*(.*)$/);
  if (m) return { big: m[1]!, small: m[2] ?? "" };
  return { big: label, small: "" };
}

function strip(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function firstWords(s: string, n: number): string {
  const words = s.split(/\s+/);
  return words.length <= n ? s : words.slice(0, n).join(" ") + "…";
}

function trim2(s: string): string {
  const parts = s.split(/([.!?]\s+)/).reduce<string[]>((acc, p, i, arr) => {
    if (i % 2 === 0 && p.trim()) acc.push(p + (arr[i + 1] ?? ""));
    return acc;
  }, []);
  return (parts.length <= 2 ? s : parts.slice(0, 2).join("")).trim();
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
