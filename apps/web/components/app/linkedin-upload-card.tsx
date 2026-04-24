"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * LinkedIn PDF upload card for /app.
 *
 * Shows when the latest scan's evaluator flagged missing work OR
 * education AND the user has not yet uploaded a LinkedIn PDF. On
 * success the parent re-fetches and the card disappears. Parent is
 * responsible for the "should I show this?" decision — this component
 * only owns the upload form + feedback.
 *
 * No OAuth, no scraping: the user exports Me → Save to PDF on
 * linkedin.com and drops the file here. We read text-only on the
 * server (pdf-parse) and stash it in scans.linkedin_pdf_text.
 */
export function LinkedInUploadCard({
  scanId,
  onUploaded,
}: {
  scanId: string;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; chars: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);

  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setStatus({
        kind: "error",
        message: "File too large — 10MB max.",
      });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatus({
        kind: "error",
        message: "Expected a .pdf file from LinkedIn's Save to PDF export.",
      });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const form = new FormData();
      form.append("scanId", scanId);
      form.append("file", file);
      const resp = await fetch("/api/scan/upload-linkedin-pdf", {
        method: "POST",
        body: form,
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        chars?: number;
        error?: string;
        message?: string;
      };
      if (!resp.ok || !data.ok) {
        setStatus({
          kind: "error",
          message:
            data.message ??
            data.error ??
            `Upload failed (HTTP ${resp.status}).`,
        });
        return;
      }
      setStatus({ kind: "success", chars: data.chars ?? 0 });
      onUploaded?.();
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Upload failed. Try again.",
      });
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <Card className="border p-5">
      <CardHeader className="p-0 pb-3">
        <CardTitle className="text-base">Add your LinkedIn PDF</CardTitle>
        <CardDescription>
          On LinkedIn → Me → Save to PDF — most complete source for work and education.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 pt-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            "cursor-pointer rounded-lg border border-dashed p-6 text-center transition-colors",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:bg-muted/50",
          ].join(" ")}
        >
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <Upload className="size-5" aria-hidden />
            <span>
              Drop your LinkedIn PDF here or <span className="underline">browse</span>
            </span>
            <span className="text-xs">PDF only · up to 10 MB</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </div>

        {status.kind === "loading" && (
          <p className="mt-3 text-sm text-muted-foreground">Uploading…</p>
        )}
        {status.kind === "success" && (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="size-4" aria-hidden />
            Got it — extracted {status.chars.toLocaleString()} chars. Your next scan will use this.
          </p>
        )}
        {status.kind === "error" && (
          <div className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 mt-0.5" aria-hidden />
            <div className="flex-1">
              <p>{status.message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setStatus({ kind: "idle" })}
              >
                Try again
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
