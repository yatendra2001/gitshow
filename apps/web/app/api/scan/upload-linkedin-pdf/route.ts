import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/auth";

/**
 * POST /api/scan/upload-linkedin-pdf
 *
 * Multipart body: { scanId: string, file: PDF blob up to 10MB }.
 *
 * Extracts text from a user-uploaded LinkedIn PDF and writes it to
 * `scans.linkedin_pdf_text` (migration 0012) for the next scan to
 * consume. We DO NOT re-run the scan here — the user either starts a
 * new scan, or the current scan picks it up on its next LinkedIn tier
 * attempt.
 *
 * Auth: standard session cookie. The user must own the scan row.
 *
 * Runtime caveat: pdf-parse depends on `pdfjs-dist` which pulls
 * in Node built-ins that the Cloudflare Workers runtime (used in
 * production via OpenNext) doesn't fully support. We dynamic-import it
 * and fall back to a clear 501 when it can't load, matching the plan's
 * acknowledgment that PDF parsing may need an out-of-Workers worker
 * eventually. The route contract stays the same either way.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const scanId = (form.get("scanId") ?? "").toString();
  const file = form.get("file");
  if (!scanId) {
    return NextResponse.json(
      { error: "missing_scan_id" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing_file", message: "Expected multipart field 'file'." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "too_large", message: `Max ${MAX_BYTES / (1024 * 1024)}MB.` },
      { status: 413 },
    );
  }
  const type = file.type || "application/pdf";
  if (!type.toLowerCase().includes("pdf")) {
    return NextResponse.json(
      {
        error: "unsupported_type",
        message: "Expected a PDF file from LinkedIn's Save to PDF.",
      },
      { status: 415 },
    );
  }

  const { env } = await getCloudflareContext({ async: true });

  // Ownership check — anyone who isn't the owner gets the same 404
  // shape so we don't leak scan-id enumerability.
  const scan = await env.DB.prepare(
    `SELECT id FROM scans WHERE id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(scanId, session.user.id)
    .first<{ id: string }>();
  if (!scan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Extract text. Dynamic import so a build without pdf-parse (or a
  // runtime that chokes on its deps) returns a clear 501 instead of
  // a 500 stack trace.
  const buffer = new Uint8Array(await file.arrayBuffer());
  let extracted: string | null = null;
  try {
    type PdfParseFn = (
      buffer: Uint8Array | Buffer,
    ) => Promise<{ text?: string }>;
    // `pdf-parse` is an optional runtime dep — keep the path stringly
    // so the TS compiler doesn't demand it at typecheck, and the
    // Cloudflare Workers build doesn't try to bundle it when absent.
    const mod = (await import(/* @vite-ignore */ "pdf-parse" as string).catch(
      () => null,
    )) as { default?: PdfParseFn } | PdfParseFn | null;
    if (!mod) {
      return NextResponse.json(
        {
          error: "pdf_unsupported",
          message:
            "PDF processing not yet supported in this region — contact support.",
        },
        { status: 501 },
      );
    }
    const pdfParse: PdfParseFn =
      (typeof mod === "function" ? mod : mod.default) as PdfParseFn;
    const result = await pdfParse(buffer);
    extracted = (result.text ?? "").trim();
  } catch (err) {
    return NextResponse.json(
      {
        error: "pdf_parse_failed",
        message:
          err instanceof Error
            ? err.message.slice(0, 200)
            : "PDF parse failed.",
      },
      { status: 422 },
    );
  }

  if (!extracted) {
    return NextResponse.json(
      {
        error: "empty_pdf",
        message: "That PDF had no extractable text. Is it the right file?",
      },
      { status: 422 },
    );
  }

  try {
    await env.DB.prepare(
      `UPDATE scans SET linkedin_pdf_text = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(extracted, Date.now(), scanId)
      .run();
  } catch (err) {
    return NextResponse.json(
      {
        error: "db_write_failed",
        message: err instanceof Error ? err.message.slice(0, 200) : "DB error.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, chars: extracted.length });
}
