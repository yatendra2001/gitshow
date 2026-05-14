"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  repoFullName: string | null;
  technologies: string[];
  dates: string;
}

interface DraftListItem {
  id: number;
  status: "draft" | "dismissed" | "posted";
  markedPostedPlatforms: string | null;
  updatedAt: number;
  model: string;
  event: {
    id: number;
    title: string;
    summary: string | null;
    url: string | null;
    repoFullName: string | null;
    source: string;
    occurredAt: number;
  };
  contentPreview: string;
}

interface BuildClientProps {
  voiceReady: boolean;
  candidates: Candidate[];
  initialDrafts: DraftListItem[];
}

export function BuildClient({
  voiceReady,
  candidates,
  initialDrafts,
}: BuildClientProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const liveDrafts = useMemo(
    () => initialDrafts.filter((d) => d.status === "draft"),
    [initialDrafts],
  );
  const postedOrDismissed = useMemo(
    () => initialDrafts.filter((d) => d.status !== "draft"),
    [initialDrafts],
  );

  async function generateForCandidate(c: Candidate) {
    if (!voiceReady) {
      setError("Calibrate your voice first.");
      return;
    }
    setError(null);
    setGenerating(c.id);
    try {
      const res = await fetch("/api/build/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            source: "kg_project",
            title: c.title,
            summary: c.summary,
            url: c.url,
            repoFullName: c.repoFullName,
            metadata: { technologies: c.technologies, dates: c.dates },
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; draftId?: number; message?: string; error?: string }
        | null;
      if (!res.ok || !data?.draftId) {
        setError(
          data?.message ?? data?.error ?? `Generation failed (${res.status})`,
        );
        setGenerating(null);
        return;
      }
      setGenerating(null);
      startTransition(() => {
        router.push(`/app/build/${data.draftId}`);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setGenerating(null);
    }
  }

  return (
    <div className="space-y-10">
      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/[0.04] px-3 py-2 text-[12.5px] text-red-500">
          {error}
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-[15px] font-medium">Candidates</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              Top shipped projects from your portfolio. Pick one to draft.
            </p>
          </div>
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {candidates.length} ready
          </span>
        </div>

        {candidates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              No candidates yet. Publish a portfolio first, or come back after
              your next scan picks up a new project.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                onGenerate={() => generateForCandidate(c)}
                generating={generating === c.id}
                disabled={!voiceReady || (generating !== null && generating !== c.id) || isPending}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-[15px] font-medium">Drafts</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              Edit each one, mark it posted when it&apos;s live.
            </p>
          </div>
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {liveDrafts.length} live
          </span>
        </div>

        {liveDrafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              No drafts in flight. Pick a candidate above to generate one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {liveDrafts.map((d) => (
              <DraftRow key={d.id} draft={d} />
            ))}
          </div>
        )}
      </section>

      {postedOrDismissed.length > 0 ? (
        <section>
          <h2 className="text-[15px] font-medium mb-3">Archive</h2>
          <div className="grid grid-cols-1 gap-2">
            {postedOrDismissed.map((d) => (
              <DraftRow key={d.id} draft={d} compact />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CandidateCard({
  candidate,
  onGenerate,
  generating,
  disabled,
}: {
  candidate: Candidate;
  onGenerate: () => void;
  generating: boolean;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-4 flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[14.5px] font-medium leading-snug">
            {candidate.title}
          </h3>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground line-clamp-2 leading-relaxed">
          {candidate.summary || "No description on this project yet."}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {candidate.technologies.slice(0, 5).map((t) => (
          <span
            key={t}
            className="inline-flex items-center rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
          >
            {t}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11.5px] text-muted-foreground/80 truncate">
          {candidate.repoFullName ?? candidate.dates}
        </span>
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={disabled || generating}
          className="h-7 px-3 text-[12px]"
        >
          {generating ? "Drafting…" : "Draft a post"}
        </Button>
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  compact,
}: {
  draft: DraftListItem;
  compact?: boolean;
}) {
  const statusLabel =
    draft.status === "posted"
      ? `Posted${draft.markedPostedPlatforms ? ` · ${draft.markedPostedPlatforms}` : ""}`
      : draft.status === "dismissed"
        ? "Dismissed"
        : "Draft";
  return (
    <Link
      href={`/app/build/${draft.id}`}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/40",
        "px-4 py-3 transition-colors duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        "hover:bg-card hover:border-border",
        compact && "py-2",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              draft.status === "posted"
                ? "bg-emerald-500"
                : draft.status === "dismissed"
                  ? "bg-muted-foreground/40"
                  : "bg-sky-500",
            )}
          />
          <p className="text-[13.5px] font-medium truncate">
            {draft.event.title}
          </p>
        </div>
        {!compact ? (
          <p className="mt-1 text-[12px] text-muted-foreground line-clamp-1">
            {draft.contentPreview}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {statusLabel}
      </span>
    </Link>
  );
}
