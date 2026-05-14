"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DraftBlob } from "@/lib/bip-ai";

interface DraftEditorProps {
  draftId: number;
  initialContent: DraftBlob;
  initialStatus: "draft" | "dismissed" | "posted";
  markedPostedPlatforms: string | null;
  model: string;
}

const X_TWEET_LIMIT = 270;
const LI_SOFT_TARGET = 1800;
const LI_HARD_LIMIT = 3000;

export function DraftEditor({
  draftId,
  initialContent,
  initialStatus,
  markedPostedPlatforms,
  model,
}: DraftEditorProps) {
  const router = useRouter();
  const [content, setContent] = useState<DraftBlob>(initialContent);
  const [status, setStatus] = useState(initialStatus);
  const [posted, setPosted] = useState<Set<string>>(
    new Set((markedPostedPlatforms ?? "").split(",").filter(Boolean)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  async function save(extra?: { status?: "posted" | "dismissed" | "draft"; postedPlatforms?: string }) {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { content };
      if (extra?.status) body.status = extra.status;
      if (extra?.postedPlatforms !== undefined)
        body.markedPostedPlatforms = extra.postedPlatforms || null;
      const res = await fetch(`/api/build/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string }
        | null;
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? `Save failed (${res.status})`);
        setSaving(false);
        return;
      }
      setSaving(false);
      setSavedAt(Date.now());
      if (extra?.status) setStatus(extra.status);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSaving(false);
    }
  }

  function updateXTweet(i: number, value: string) {
    setContent((prev) => {
      const arr = [...(prev.x_thread ?? [])];
      arr[i] = value;
      return { ...prev, x_thread: arr };
    });
  }
  function removeXTweet(i: number) {
    setContent((prev) => {
      const arr = [...(prev.x_thread ?? [])];
      arr.splice(i, 1);
      return { ...prev, x_thread: arr.length > 0 ? arr : undefined };
    });
  }
  function addXTweet() {
    setContent((prev) => ({
      ...prev,
      x_thread: [...(prev.x_thread ?? []), ""],
    }));
  }
  function setLinkedIn(value: string) {
    setContent((prev) => ({ ...prev, linkedin: value }));
  }
  function setBlogTitle(value: string) {
    setContent((prev) => ({
      ...prev,
      blog: {
        title: value,
        body_md: prev.blog?.body_md ?? "",
      },
    }));
  }
  function setBlogBody(value: string) {
    setContent((prev) => ({
      ...prev,
      blog: {
        title: prev.blog?.title ?? "",
        body_md: value,
      },
    }));
  }

  function togglePosted(platform: string) {
    setPosted((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  async function markPosted() {
    const list = Array.from(posted).join(",");
    await save({ status: "posted", postedPlatforms: list });
  }

  async function dismiss() {
    if (!confirm("Dismiss this draft? It moves to the archive.")) return;
    await save({ status: "dismissed" });
  }

  async function reopen() {
    await save({ status: "draft" });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/[0.04] px-3 py-2 text-[12.5px] text-red-500">
          {error}
        </div>
      ) : null}

      {/* X Thread */}
      {content.x_thread ? (
        <PlatformCard
          title="X / Twitter thread"
          subtitle={`${content.x_thread.length} tweets`}
          posted={posted.has("x_thread")}
          onTogglePosted={() => togglePosted("x_thread")}
        >
          <div className="space-y-3">
            {content.x_thread.map((t, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    Tweet {i + 1}/{content.x_thread!.length}
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        t.length > X_TWEET_LIMIT
                          ? "text-red-500"
                          : t.length > X_TWEET_LIMIT - 20
                            ? "text-amber-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {t.length}/{X_TWEET_LIMIT}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeXTweet(i)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <Textarea
                  value={t}
                  onChange={(e) => updateXTweet(i, e.target.value)}
                  rows={3}
                  className="min-h-[80px]"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addXTweet}
              className="h-7 text-[12px]"
            >
              Add tweet
            </Button>
          </div>
        </PlatformCard>
      ) : null}

      {/* LinkedIn */}
      {content.linkedin !== undefined ? (
        <PlatformCard
          title="LinkedIn post"
          subtitle={`${content.linkedin?.length ?? 0} chars · target ${LI_SOFT_TARGET}`}
          posted={posted.has("linkedin")}
          onTogglePosted={() => togglePosted("linkedin")}
        >
          <Textarea
            value={content.linkedin ?? ""}
            onChange={(e) => setLinkedIn(e.target.value.slice(0, LI_HARD_LIMIT))}
            rows={12}
            className="min-h-[260px] font-sans"
          />
          <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
            {content.linkedin?.length ?? 0}/{LI_HARD_LIMIT}
          </p>
        </PlatformCard>
      ) : null}

      {/* Blog */}
      {content.blog ? (
        <PlatformCard
          title="Blog stub"
          subtitle="Long-form, markdown"
          posted={posted.has("blog")}
          onTogglePosted={() => togglePosted("blog")}
        >
          <input
            type="text"
            value={content.blog.title}
            onChange={(e) => setBlogTitle(e.target.value)}
            placeholder="Blog title"
            className={cn(
              "h-10 w-full rounded-md border border-border bg-background px-3",
              "text-[15px] font-medium placeholder:text-muted-foreground/60",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          />
          <Textarea
            value={content.blog.body_md}
            onChange={(e) => setBlogBody(e.target.value)}
            rows={20}
            className="mt-3 min-h-[400px] font-mono text-[13px]"
          />
        </PlatformCard>
      ) : null}

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/95 backdrop-blur px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
          <span>
            Status: <span className="text-foreground font-medium">{status}</span>
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline font-mono">{model}</span>
          {savedAt ? (
            <span className="hidden sm:inline">
              · saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {status === "draft" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={dismiss}
                disabled={saving || isPending}
              >
                Dismiss
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => save()}
                disabled={saving || isPending}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={markPosted}
                disabled={saving || isPending || posted.size === 0}
              >
                Mark posted ({posted.size})
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={reopen}
              disabled={saving || isPending}
            >
              Reopen as draft
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlatformCard({
  title,
  subtitle,
  posted,
  onTogglePosted,
  children,
}: {
  title: string;
  subtitle: string;
  posted: boolean;
  onTogglePosted: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium">{title}</h3>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={posted}
            onChange={onTogglePosted}
            className="h-3.5 w-3.5 rounded border-border accent-foreground"
          />
          <span className={posted ? "text-emerald-500" : "text-muted-foreground"}>
            posted
          </span>
        </label>
      </div>
      {children}
    </div>
  );
}
