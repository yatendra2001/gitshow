import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadDashboardContext } from "../_context";
import { getDomainByUser } from "@/lib/domains/repo";
import { CNAME_TARGET } from "@/lib/domains/security";
import { PROVIDERS, type ProviderId } from "@/lib/domains/providers";
import { DomainPanel } from "./_panel";
import { ProUpsell } from "./_pro-upsell";

/**
 * /app/domain — custom domain settings.
 *
 * Surface tree:
 *   - Not Pro      → ProUpsell (matches the rest of the dashboard)
 *   - Pro, no row  → DomainPanel in the empty state (input + helper)
 *   - Pro, row     → DomainPanel showing the timeline + status
 *
 * The Pro user only ever has one domain (UNIQUE on user_id), so the
 * "list" pattern doesn't apply — single panel.
 */

export const dynamic = "force-dynamic";

export default async function DomainPage() {
  const ctx = await loadDashboardContext();
  if (!ctx) redirect("/signin");

  if (!ctx.isPro) {
    return <ProUpsell />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const row = await getDomainByUser(env.DB, ctx.userId);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
            Settings
          </div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold leading-none tracking-tight">
            Custom domain
          </h1>
          <p className="mt-2 text-[12.5px] text-muted-foreground text-pretty">
            Serve your portfolio from a domain you own — apex (
            <span className="font-mono text-foreground">yatendra.com</span>) or a
            subdomain (
            <span className="font-mono text-foreground">portfolio.yatendra.com</span>
            ). One domain per Pro account.
          </p>
        </div>
        {ctx.profile?.public_slug ? (
          <Link
            href={`/${ctx.profile.public_slug}`}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-1 self-start rounded-md px-2 py-1.5 text-[12px] font-mono text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-[background-color,color] duration-[140ms]"
          >
            <span className="truncate">gitshow.io/{ctx.profile.public_slug}</span>
            <Icon
              icon={ArrowUpRight01Icon}
              className="size-3 transition-transform duration-[180ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] group-hover:-translate-y-px group-hover:translate-x-px"
            />
          </Link>
        ) : null}
      </header>

      <DomainPanel
        initial={
          row
            ? {
                id: row.id,
                hostname: row.hostname,
                isApex: row.is_apex === 1,
                apexStrategy: row.apex_strategy,
                status: row.status,
                detectedProvider: row.detected_provider,
                providerLabel: row.detected_provider
                  ? PROVIDERS[row.detected_provider as ProviderId]?.label ??
                    row.detected_provider
                  : null,
                verificationToken: row.verification_token,
                cfSslStatus: row.cf_ssl_status,
                failureReason: row.failure_reason,
                createdAt: row.created_at,
                activatedAt: row.activated_at,
                lastCheckAt: row.last_check_at,
              }
            : null
        }
        cnameTarget={CNAME_TARGET}
        publicSlug={ctx.profile?.public_slug ?? ctx.handle.toLowerCase()}
      />
    </div>
  );
}
