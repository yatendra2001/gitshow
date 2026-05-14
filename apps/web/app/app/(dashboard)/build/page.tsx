import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadDashboardContext } from "../_context";
import { loadPublishedResume } from "@/lib/resume-io";
import {
  listDraftsWithEvents,
  loadVoiceProfile,
  type DraftWithEvent,
} from "@/lib/bip-data";
import type { Project } from "@gitshow/shared/resume";
import { BuildClient } from "./_build-client";

/**
 * /app/build — the build-in-public inbox.
 *
 * Layout:
 *   - Voice-calibration banner if not yet calibrated.
 *   - "Candidates" section: top projects from the published resume.
 *     One click sends them through the draft generator.
 *   - "Drafts" section: every existing draft, newest first. Each card
 *     links to /app/build/[id] for the editor.
 *
 * Pro-gated. /app/voice must be calibrated before the candidate cards
 * become clickable — the API refuses to draft without a voice profile.
 */

export const dynamic = "force-dynamic";

export default async function BuildPage() {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");
  if (!ctx.isPro) redirect("/pricing");

  const { env } = await getCloudflareContext({ async: true });
  const [drafts, profile, resume] = await Promise.all([
    listDraftsWithEvents(env.DB, ctx.userId, 50),
    loadVoiceProfile(env.DB, ctx.userId),
    ctx.handle ? loadPublishedResume(env.BUCKET, ctx.handle) : null,
  ]);

  const voiceReady = profile !== null;
  const candidates = resume ? pickCandidates(resume.projects, drafts) : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-8">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Build in public · inbox
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
          Your commits already wrote the post.
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground max-w-2xl">
          Pick a shipped project. We&apos;ll draft an X thread, a LinkedIn post,
          and a blog stub in your voice — based on your real code, real
          description, real links. You edit. You post.
        </p>
      </div>

      {!voiceReady ? (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/[0.04] px-4 py-3">
          <div className="flex items-start justify-between gap-3 flex-col sm:flex-row sm:items-center">
            <div>
              <p className="text-[13.5px] font-medium">
                Calibrate your voice first.
              </p>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Drafts without a voice profile read like generic LLM output.
                Two samples is enough.
              </p>
            </div>
            <Link
              href="/app/voice"
              className="inline-flex items-center rounded-md border border-amber-500/40 px-3 py-1 text-[12px] font-medium text-foreground hover:bg-amber-500/10"
            >
              Calibrate voice →
            </Link>
          </div>
        </div>
      ) : null}

      <BuildClient
        voiceReady={voiceReady}
        candidates={candidates}
        initialDrafts={drafts.map((d) => ({
          id: d.draft.id,
          status: d.draft.status,
          markedPostedPlatforms: d.draft.marked_posted_platforms,
          updatedAt: d.draft.updated_at,
          model: d.draft.model,
          event: {
            id: d.event.id,
            title: d.event.title,
            summary: d.event.summary,
            url: d.event.url,
            repoFullName: d.event.repo_full_name,
            source: d.event.source,
            occurredAt: d.event.occurred_at,
          },
          contentPreview: previewContent(d),
        }))}
      />
    </div>
  );
}

interface Candidate {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  repoFullName: string | null;
  technologies: string[];
  dates: string;
}

function pickCandidates(
  projects: Project[],
  drafts: DraftWithEvent[],
): Candidate[] {
  if (!projects || projects.length === 0) return [];
  const draftedKeys = new Set<string>();
  for (const d of drafts) {
    const k = (d.event.repo_full_name || d.event.title).toLowerCase();
    draftedKeys.add(k);
  }
  return projects
    .map((p) => {
      const repoFullName = extractRepoFullName(p);
      return {
        id: p.id,
        title: p.title,
        summary: stripMarkdown(p.description).slice(0, 240),
        url: p.href ?? p.links?.[0]?.href ?? null,
        repoFullName,
        technologies: p.technologies ?? [],
        dates: p.dates,
        _key: (repoFullName || p.title).toLowerCase(),
        _userShare: p.userShare ?? 0,
      };
    })
    .filter((p) => !draftedKeys.has(p._key))
    .sort((a, b) => b._userShare - a._userShare)
    .slice(0, 8)
    .map(({ _key, _userShare, ...c }) => {
      void _key;
      void _userShare;
      return c;
    });
}

function extractRepoFullName(p: Project): string | null {
  const candidates = [p.href, ...(p.links?.map((l) => l.href) ?? [])].filter(
    (u): u is string => typeof u === "string",
  );
  for (const u of candidates) {
    try {
      const url = new URL(u);
      if (url.hostname === "github.com") {
        const parts = url.pathname.replace(/^\//, "").split("/");
        if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function previewContent(d: DraftWithEvent): string {
  if (d.content.x_thread?.[0]) return d.content.x_thread[0];
  if (d.content.linkedin) return d.content.linkedin.split("\n")[0] ?? "";
  if (d.content.blog?.title) return d.content.blog.title;
  return "(draft is empty)";
}
