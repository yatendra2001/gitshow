import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DataProvider } from "@/components/data-provider";
import { getTemplateComponent } from "@/components/templates";
import { getAdminUserDetail } from "@/lib/admin-queries";
import { loadDraftResume, loadPublishedResume } from "@/lib/resume-io";

/**
 * Full-bleed admin preview of any user's draft (or published) Resume.
 *
 * Lives outside the `(dashboard)` route group so the dashboard sidebar
 * doesn't compete with the template's own chrome. The render path is
 * IDENTICAL to the public `/{handle}` route — same DataProvider, same
 * template registry — so what the operator sees here is exactly what
 * the user would see if they hit publish right now.
 *
 * `?source=published` flips to the live published Resume (when set).
 * Default is the draft.
 */

export const dynamic = "force-dynamic";

export default async function AdminPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ source?: string | string[] }>;
}) {
  const { userId } = await params;
  const sp = (await searchParams) ?? {};
  const sourceParam = Array.isArray(sp.source) ? sp.source[0] : sp.source;
  const wantPublished = sourceParam === "published";

  const { env } = await getCloudflareContext({ async: true });
  const user = await getAdminUserDetail(env.DB, userId);
  if (!user) notFound();
  const handle = user.handle ?? user.login ?? null;
  if (!handle) notFound();

  const [draft, published] = await Promise.all([
    loadDraftResume(env.BUCKET, handle),
    loadPublishedResume(env.BUCKET, handle),
  ]);

  const resume = wantPublished ? published : (draft ?? published);
  if (!resume) {
    return (
      <main className="min-h-svh bg-background text-foreground flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-[12.5px] uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
            Admin preview
          </p>
          <h1 className="text-[24px] font-semibold mb-2">Nothing to preview yet</h1>
          <p className="text-[13px] text-muted-foreground mb-6">
            @{user.login ?? handle} doesn&apos;t have a draft or published resume saved.
          </p>
          <Link
            href={`/app/admin/users/${user.user_id}`}
            className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 px-3 py-1.5 text-[12.5px] font-medium hover:bg-card"
          >
            ← Back to user
          </Link>
        </div>
      </main>
    );
  }

  const Template = getTemplateComponent(resume.theme.template);
  const showingPublished = wantPublished || !draft;

  return (
    <div className="portfolio-theme relative">
      <AdminPreviewBar
        user={{
          userId: user.user_id,
          login: user.login,
          handle,
          publicSlug: user.public_slug,
        }}
        showingPublished={showingPublished}
        hasDraft={Boolean(draft)}
        hasPublished={Boolean(published)}
        templateId={resume.theme.template}
        version={resume.meta.version ?? 0}
      />
      <DataProvider resume={resume} handle={handle}>
        <Template />
      </DataProvider>
    </div>
  );
}

function AdminPreviewBar({
  user,
  showingPublished,
  hasDraft,
  hasPublished,
  templateId,
  version,
}: {
  user: {
    userId: string;
    login: string | null;
    handle: string;
    publicSlug: string | null;
  };
  showingPublished: boolean;
  hasDraft: boolean;
  hasPublished: boolean;
  templateId: string;
  version: number;
}) {
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full border border-border/60 bg-background/85 backdrop-blur-md px-3 py-1.5 text-[11.5px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.3)]">
      <span className="inline-flex items-center gap-1 text-rose-500">
        <span className="size-1.5 rounded-full bg-rose-500" />
        ADMIN
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground font-medium">
        @{user.login ?? user.handle}
      </span>
      <span className="text-muted-foreground hidden sm:inline">
        · {showingPublished ? "published" : "draft"} · {templateId} · v{version}
      </span>
      <span className="mx-1 h-3 w-px bg-border/60" />
      <ToggleLink
        active={!showingPublished}
        href={`/app/admin-preview/${user.userId}?source=draft`}
        disabled={!hasDraft}
        label="Draft"
      />
      <ToggleLink
        active={showingPublished}
        href={`/app/admin-preview/${user.userId}?source=published`}
        disabled={!hasPublished}
        label="Published"
      />
      <span className="mx-1 h-3 w-px bg-border/60" />
      {user.publicSlug ? (
        <a
          href={`/${user.publicSlug}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground"
        >
          Live ↗
        </a>
      ) : null}
      <Link
        href={`/app/admin/users/${user.userId}`}
        className="text-muted-foreground hover:text-foreground"
      >
        Back
      </Link>
    </div>
  );
}

function ToggleLink({
  active,
  href,
  label,
  disabled,
}: {
  active: boolean;
  href: string;
  label: string;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <span className="px-2 py-0.5 rounded-full text-muted-foreground/40 cursor-not-allowed">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={
        active
          ? "px-2 py-0.5 rounded-full bg-foreground text-background font-medium"
          : "px-2 py-0.5 rounded-full text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </Link>
  );
}
