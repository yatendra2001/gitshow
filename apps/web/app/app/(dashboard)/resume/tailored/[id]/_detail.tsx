"use client";

/**
 * Tailored-resume detail view — preview pane + Download PDF + Delete +
 * collapsible JD reference. Read-only by design: if a user wants to
 * fine-tune they re-tailor with a tweaked JD. The base resume editor
 * is the single editing surface; tailored variants are snapshots tied
 * to a specific JD.
 *
 * Reuses `<ScaledResumePreview>` for the centered scaled preview and
 * the `<ResumeShellToolbar>` for the persistent tabs strip.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download04Icon,
  Delete02Icon,
  Loading03Icon,
  ArrowLeft01Icon,
  JobSearchIcon,
} from "@hugeicons/core-free-icons";
import type { TailoredResume } from "@gitshow/shared/tailored-resume";
import { tailoredDisplayLabel } from "@gitshow/shared/tailored-resume";
import { ResumeShellToolbar } from "../../_shell";
import { ScaledResumePreview } from "@/components/resume/scaled-preview";
import { cn } from "@/lib/utils";

export function TailoredDetailView({
  tailored,
  tailoredCount,
}: {
  tailored: TailoredResume;
  tailoredCount: number;
}) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const label = tailoredDisplayLabel(tailored.meta);
  const createdLabel = useMemo(
    () =>
      new Date(tailored.meta.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [tailored.meta.createdAt],
  );

  const onDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      const resp = await fetch("/api/resume/doc/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: tailored.doc }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setDownloadErr(body.detail || humanizeError(body.error));
        return;
      }
      const blob = await resp.blob();
      const baseName =
        (tailored.doc.header.name || "resume")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-") +
        "-" +
        (tailored.meta.company || tailored.meta.jobTitle || "tailored")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadErr("PDF download failed");
    } finally {
      setDownloading(false);
    }
  }, [tailored, downloading]);

  const onDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      const resp = await fetch(`/api/resume/tailored/${tailored.meta.id}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setDeleteErr(body.detail || humanizeError(body.error));
        setDeleting(false);
        return;
      }
      router.push("/app/resume/tailored");
      router.refresh();
    } catch {
      setDeleteErr("Delete failed");
      setDeleting(false);
    }
  }, [tailored.meta.id, deleting, router]);

  const trailing = (
    <div className="flex items-center gap-2">
      {downloadErr || deleteErr ? (
        <span className="hidden sm:inline-block text-[11px] text-foreground">
          {downloadErr || deleteErr}
        </span>
      ) : null}
      {deleteConfirm ? (
        <>
          <span className="hidden sm:inline-block text-[12px] text-muted-foreground">
            Delete this version?
          </span>
          <button
            type="button"
            onClick={() => setDeleteConfirm(false)}
            disabled={deleting}
            className={cn(
              "inline-flex items-center rounded-md h-8 px-2.5 text-[12px]",
              "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
              "transition-[background-color,color] duration-150 ease",
              "min-h-9",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12px] font-medium",
              "bg-[var(--destructive)] text-white",
              "transition-[opacity] duration-150 ease",
              "hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-9",
            )}
          >
            <HugeiconsIcon
              icon={deleting ? Loading03Icon : Delete02Icon}
              size={12}
              strokeWidth={2}
              className={deleting ? "animate-spin" : undefined}
            />
            {deleting ? "Deleting" : "Confirm delete"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setDeleteConfirm(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md h-8 px-2.5 text-[12px]",
            "text-muted-foreground hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/[0.08]",
            "transition-[background-color,color] duration-150 ease",
            "min-h-9",
          )}
          aria-label="Delete this tailored resume"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
          <span className="hidden sm:inline">Delete</span>
        </button>
      )}
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-[12px] font-medium",
          "bg-foreground text-background min-h-9",
          "transition-[opacity] duration-150 ease",
          "hover:opacity-90 disabled:opacity-50 disabled:cursor-progress",
        )}
      >
        <HugeiconsIcon
          icon={downloading ? Loading03Icon : Download04Icon}
          size={13}
          strokeWidth={2}
          className={downloading ? "animate-spin" : undefined}
        />
        {downloading ? "Generating" : "Download PDF"}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col min-h-[calc(100svh-3.5rem)]">
      <ResumeShellToolbar
        active="tailored"
        tailoredCount={tailoredCount}
        trailing={trailing}
      />

      <main className="mx-auto w-full max-w-5xl px-5 sm:px-6 py-6 sm:py-8">
        <Link
          href="/app/resume/tailored"
          className={cn(
            "inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground",
            "transition-colors duration-150 ease",
            "rounded-md -ml-1.5 px-1.5 h-7 min-h-9",
          )}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={12} strokeWidth={2} />
          Tailored versions
        </Link>

        <header className="mt-3 mb-5 flex items-start gap-3">
          <div className="mt-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05]">
            <HugeiconsIcon
              icon={JobSearchIcon}
              size={12}
              strokeWidth={2}
              className="text-foreground/80"
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight leading-tight truncate">
              {label}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
              Tailored {createdLabel}
            </p>
          </div>
        </header>

        <ScaledResumePreview doc={tailored.doc} scale={0.72} />

        <JdAccordion jd={tailored.jobDescription} />
      </main>
    </div>
  );
}

function JdAccordion({ jd }: { jd: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full text-left rounded-lg border border-border/40 bg-foreground/[0.015]",
          "px-3.5 py-2.5 flex items-center gap-2",
          "transition-[background-color,border-color] duration-150 ease",
          "hover:bg-foreground/[0.03] hover:border-border/60",
          "min-h-9",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block text-[11px] text-muted-foreground/70 tabular-nums w-3 text-center",
            "transition-transform duration-150 ease",
            open ? "rotate-90" : "rotate-0",
          )}
        >
          ▸
        </span>
        <span className="text-[12.5px] font-medium">
          Job description{" "}
          <span className="text-muted-foreground/60 font-normal tabular-nums">
            {jd.length.toLocaleString()} chars
          </span>
        </span>
      </button>
      {open ? (
        <pre
          className={cn(
            "mt-2 rounded-lg border border-border/40 bg-foreground/[0.02]",
            "px-3.5 py-2.5 max-h-[40vh] overflow-y-auto gs-pane-scroll",
            "text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-sans",
          )}
        >
          {jd}
        </pre>
      ) : null}
    </section>
  );
}

function humanizeError(code?: string): string {
  switch (code) {
    case "pdf_render_failed":
      return "PDF render failed.";
    case "browser_not_bound":
      return "PDF service unavailable.";
    case "payment_required":
      return "A Pro subscription is required.";
    case "not_found":
      return "This tailored resume no longer exists.";
    case "delete_failed":
      return "Couldn't delete this tailored resume.";
    default:
      return code || "Something went wrong";
  }
}
