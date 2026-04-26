import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireProPage } from "@/lib/entitlements";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";
import { Editor } from "./_editor";

/**
 * /app/edit — full per-section editor over the authenticated user's
 * draft Resume.
 *
 * Renders inside the dashboard shell so the sidebar persists. We don't
 * own a <main> wrapper or header — the shell provides both.
 */

export const dynamic = "force-dynamic";

export default async function EditPage() {
  const session = await requireProPage();
  const handle = session.user.login!;
  const { env } = await getCloudflareContext({ async: true });
  const [resume, published] = await Promise.all([
    loadDraftResume(env.BUCKET, handle),
    loadPublishedResume(env.BUCKET, handle),
  ]);

  if (!resume) {
    return <EmptyState />;
  }

  return (
    <Editor
      initialResume={resume}
      handle={handle}
      initialPublished={Boolean(published)}
    />
  );
}

function EmptyState() {
  return (
    <section className="mx-auto w-full max-w-xl px-4 sm:px-6 py-16">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Nothing to edit yet
      </div>
      <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
        No draft found
      </h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
        Run a scan first — the editor lives on top of a generated draft.
        Once the AI pipeline finishes, this page will show your full
        portfolio ready to tune.
      </p>
      <Link
        href="/app"
        className="inline-flex items-center rounded-xl bg-foreground text-background px-4 py-2 text-[13px] font-medium hover:opacity-90 min-h-11"
      >
        Back to dashboard
      </Link>
    </section>
  );
}
