import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadDashboardContext } from "../../_context";
import { loadDraftWithEvent } from "@/lib/bip-data";
import { DraftEditor } from "./_draft-editor";

/**
 * /app/build/[id] — draft editor.
 *
 * Server-loads the draft + its source event, hands the content blob to
 * a client editor. Each platform (x_thread / linkedin / blog) renders
 * as its own card; the user edits, saves, and marks posted per
 * platform when it goes live.
 */

export const dynamic = "force-dynamic";

export default async function DraftEditPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");
  if (!ctx.isPro) redirect("/pricing");

  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isInteger(draftId) || draftId <= 0) notFound();

  const { env } = await getCloudflareContext({ async: true });
  const row = await loadDraftWithEvent(env.DB, ctx.userId, draftId);
  if (!row) notFound();

  const occurred = new Date(row.event.occurred_at);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-2">
        <Link
          href="/app/build"
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          ← Back to inbox
        </Link>
      </div>
      <div className="mb-8">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Draft · {row.event.source}
        </div>
        <h1 className="text-[24px] sm:text-[28px] font-semibold leading-tight tracking-tight">
          {row.event.title}
        </h1>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {row.event.repo_full_name ? (
            <>
              <span className="font-mono">{row.event.repo_full_name}</span>
              {" · "}
            </>
          ) : null}
          {occurred.toLocaleDateString()}
          {row.event.url ? (
            <>
              {" · "}
              <a
                href={row.event.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-foreground hover:underline"
              >
                source link ↗
              </a>
            </>
          ) : null}
        </p>
      </div>

      <DraftEditor
        draftId={draftId}
        initialContent={row.content}
        initialStatus={row.draft.status}
        markedPostedPlatforms={row.draft.marked_posted_platforms}
        model={row.draft.model}
      />
    </div>
  );
}
