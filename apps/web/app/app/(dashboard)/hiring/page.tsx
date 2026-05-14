import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadDashboardContext } from "../_context";
import {
  getDiscoverable,
  listRecruiterInbound,
  loadOpenToWorkSettings,
} from "@/lib/bip-data";
import { HiringClient } from "./_hiring-client";

/**
 * /app/hiring — open-to-work surface + recruiter inbox.
 *
 * Two panels:
 *   1. Settings — discoverable toggle, status (looking/selectively/none),
 *      desired roles/locations/comp, public blurb, contact email.
 *      Drives the portfolio's "open to" badge + contact form.
 *   2. Inbox — recruiter contact-form submissions, sorted by fit_score.
 *      Each row inline-expands; mark read/replied/archived/spam.
 *
 * Pro-gated.
 */

export const dynamic = "force-dynamic";

export default async function HiringPage() {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");
  if (!ctx.isPro) redirect("/pricing");

  const { env } = await getCloudflareContext({ async: true });
  const [settings, discoverable, inbox] = await Promise.all([
    loadOpenToWorkSettings(env.DB, ctx.userId),
    getDiscoverable(env.DB, ctx.userId),
    listRecruiterInbound(env.DB, ctx.userId, 100),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-8">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
          Hiring · inbound
        </div>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
          Open to work.
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground max-w-2xl">
          Tell recruiters what you&apos;re open to. Your portfolio shows a
          subtle &quot;open to&quot; badge plus a contact form. Inbounds land here,
          ranked by fit. Anti-LinkedIn-firehose: you stay in control.
        </p>
      </div>

      <HiringClient
        initialDiscoverable={discoverable}
        initialSettings={settings}
        initialInbox={inbox}
        portfolioSlug={ctx.profile?.public_slug ?? ctx.handle.toLowerCase()}
      />
    </div>
  );
}
