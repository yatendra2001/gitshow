import { getCloudflareContext } from "@opennextjs/cloudflare";
import puppeteer from "@cloudflare/puppeteer";
import { requireProApi } from "@/lib/entitlements";
import { loadResumeDoc } from "@/lib/resume-doc-io";
import {
  renderResumeHtml,
  RESUME_PRINT_CSS,
} from "@/components/resume/printable-html";

/**
 * POST /api/resume/doc/pdf — render the user's ResumeDoc to a PDF via
 * Cloudflare Browser Rendering and return it as an attachment.
 *
 * We render the document to an HTML string (no React-server dep), wrap
 * it with an HTML shell that carries the print CSS, and feed the whole
 * thing to `page.setContent()`. No external assets are loaded — the
 * resume is pure typography on white, so the binary cost is minimal.
 */

export const maxDuration = 60;

export async function POST() {
  const gate = await requireProApi();
  if (!gate.ok) return gate.response;
  const session = gate.session;
  if (!session.user.login) {
    return jsonError("no_handle", 400);
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!env.BUCKET) return jsonError("r2_not_bound", 500);
  if (!env.BROWSER) {
    return jsonError(
      "browser_not_bound",
      503,
      "Cloudflare Browser Rendering binding missing. Add it in wrangler.jsonc and redeploy.",
    );
  }

  const handle = session.user.login;
  const doc = await loadResumeDoc(env.BUCKET, handle);
  if (!doc) {
    return jsonError("no_doc", 404, "Generate the resume first.");
  }

  const inner = renderResumeHtml(doc, { fullPage: true });
  const pageSize = doc.page.size === "a4" ? "A4" : "Letter";
  // CRITICAL: RESUME_PRINT_CSS must come FIRST in the <style> block.
  // Its @import for Inter has to be the first rule in the stylesheet
  // — anything before it (like @page or body resets) makes the
  // browser silently drop the @import, and we'd be rendering the PDF
  // with Linux Liberation Sans instead of Inter, breaking the editor↔
  // PDF parity guarantee. The preconnect link is there to start the
  // font fetch as early as possible.
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Resume</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
${RESUME_PRINT_CSS}
@page { size: ${pageSize}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>${inner}</body>
</html>`;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER as Fetcher);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Belt-and-suspenders for the editor↔PDF parity guarantee. The CSS
    // @import for Inter usually finishes before networkidle0 fires, but
    // if it doesn't, a swap could happen mid-render and the PDF would
    // be laid out with Arial fallback metrics — mismatching what the
    // editor preview measured. Awaiting document.fonts.ready blocks
    // page.pdf() until every @font-face is fully usable.
    await page
      .evaluate(() => (document as Document).fonts.ready)
      .catch(() => {});
    const buffer = await page.pdf({
      format: pageSize,
      printBackground: true,
      preferCSSPageSize: true,
    });
    await browser.close();
    browser = null;

    const filename = `${slug(doc.header.name || handle)}-resume.pdf`;
    return new Response(buffer as unknown as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : "unknown";
    return jsonError("pdf_render_failed", 502, msg);
  }
}

function jsonError(code: string, status: number, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "resume"
  );
}
