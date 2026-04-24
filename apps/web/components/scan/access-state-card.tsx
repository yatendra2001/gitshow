"use client";

import Image from "next/image";
import { Lock, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders the GitHub access state surfaced by the worker's github-fetcher
 * (serialized into the `scans.access_state` + `scans.data_sources`
 * columns via migration 0011).
 *
 * Two responsibilities:
 *   1. Show data-source counts so the user can judge coverage
 *      (owned/org/contribution/commit-search repos + private
 *      contribution volume).
 *   2. Surface locked orgs with a one-click SSO authorize deep link.
 *      We intentionally SHOW rather than hide locked orgs — the user
 *      needs to know *why* a repo might be missing. Clicking the
 *      "Authorize SSO" button opens github.com/orgs/{login}/sso, and
 *      re-running the scan after authorizing picks up the missing repos.
 */

export type OrgAccessState =
  | "ok"
  | "sso_required"
  | "oauth_restricted"
  | "no_membership_visible";

export interface OrgAccess {
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
  state: OrgAccessState;
  resolveUrl?: string;
  reposVisible: number;
}

export interface AccessState {
  orgs: OrgAccess[];
  privateContributionsVisible: boolean;
}

export interface DataSources {
  ownedRepos: number;
  orgRepos: number;
  contributionRepos: number;
  commitSearchRepos: number;
  orgsVisible: number;
  orgsLocked: number;
  privateContributionCount: number;
  restrictedContributionCount: number;
}

export function AccessStateCard({
  accessState,
  dataSources,
  compact = false,
}: {
  accessState: AccessState | null;
  dataSources: DataSources | null;
  compact?: boolean;
}) {
  // Hide entirely until the worker has posted the snapshot — avoids a
  // flash of "0 repos" during the ~20-30s github-fetch phase on a fresh
  // scan.
  if (!accessState && !dataSources) return null;

  const lockedOrgs = (accessState?.orgs ?? []).filter(
    (o) => o.state === "sso_required" || o.state === "oauth_restricted",
  );
  const visibleOrgs = (accessState?.orgs ?? []).filter((o) => o.state === "ok");

  return (
    <div className="flex flex-col gap-3">
      {dataSources ? (
        <DataSourcesRow dataSources={dataSources} compact={compact} />
      ) : null}
      {lockedOrgs.length > 0 ? <LockedOrgsCard orgs={lockedOrgs} /> : null}
      {accessState &&
      accessState.privateContributionsVisible === false &&
      (dataSources?.restrictedContributionCount ?? 0) > 0 ? (
        <PrivateContribHintCard
          restrictedCount={dataSources?.restrictedContributionCount ?? 0}
        />
      ) : null}
      {visibleOrgs.length > 0 && !compact ? (
        <VisibleOrgsRow orgs={visibleOrgs} />
      ) : null}
    </div>
  );
}

function DataSourcesRow({
  dataSources: d,
  compact,
}: {
  dataSources: DataSources;
  compact: boolean;
}) {
  const stats: Array<{ label: string; value: number; tip?: string }> = [
    { label: "Owned repos", value: d.ownedRepos },
    { label: "Org repos", value: d.orgRepos },
    {
      label: "Drive-by contribs",
      value: d.contributionRepos + d.commitSearchRepos,
      tip: "Repos you don't own but contributed to — PRs + commits found via GitHub search",
    },
    {
      label: "Private contribs",
      value: d.privateContributionCount,
      tip: "Commits, PRs, reviews, issues on private repos over the last year",
    },
  ];
  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-2xl border border-border/40 bg-card/30 p-3",
        compact && "p-2.5",
      )}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col gap-0.5 px-2 py-1.5"
          title={s.tip}
        >
          <span className="font-mono tabular-nums text-[18px] leading-none text-foreground">
            {s.value.toLocaleString()}
          </span>
          <span className="text-[11px] text-muted-foreground leading-tight">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function LockedOrgsCard({ orgs }: { orgs: OrgAccess[] }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 mt-0.5">
          <Lock className="size-3.5" strokeWidth={2.25} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">
            {orgs.length === 1
              ? `1 org is locked`
              : `${orgs.length} orgs are locked`}
          </span>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            We can see you&apos;re a member, but your GitHub token can&apos;t read these
            repos yet. Authorize and we&apos;ll include them on the next scan.
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {orgs.map((o) => (
          <li
            key={o.login}
            className="flex items-center justify-between gap-2 rounded-xl border border-border/40 bg-card/40 px-3 py-2"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {o.avatarUrl ? (
                <Image
                  src={o.avatarUrl}
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                  className="size-6 shrink-0 rounded-md"
                />
              ) : (
                <span className="size-6 shrink-0 rounded-md bg-muted/60" />
              )}
              <div className="flex flex-col gap-0 min-w-0">
                <span className="text-[12.5px] font-medium truncate">
                  {o.displayName ?? o.login}
                </span>
                <span className="text-[10.5px] text-muted-foreground font-mono truncate">
                  @{o.login}
                </span>
              </div>
            </div>
            {o.resolveUrl ? (
              <a
                href={o.resolveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11.5px] font-medium text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
              >
                Authorize
                <ExternalLink className="size-3" strokeWidth={2} />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrivateContribHintCard({
  restrictedCount,
}: {
  restrictedCount: number;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/30 p-4 flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/40 mt-0.5">
          <Lock className="size-3.5 text-muted-foreground" strokeWidth={2.25} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">
            {restrictedCount.toLocaleString()} private contributions aren&apos;t
            attributed
          </span>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            GitHub isn&apos;t telling us which repos they belong to. Flip{" "}
            <span className="text-foreground">
              Include private contributions on my profile
            </span>{" "}
            so we can weave them in on the next scan.
          </p>
        </div>
      </div>
      <a
        href="https://github.com/settings/profile#contributions-settings"
        target="_blank"
        rel="noreferrer"
        className="self-start inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-[11.5px] font-medium hover:bg-card/60"
      >
        Open GitHub setting
        <ExternalLink className="size-3" strokeWidth={2} />
      </a>
    </div>
  );
}

function VisibleOrgsRow({ orgs }: { orgs: OrgAccess[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11.5px] text-muted-foreground">
      <Check className="size-3 text-emerald-500" strokeWidth={2.5} />
      <span>Reading from</span>
      <span className="flex items-center gap-1.5 flex-wrap">
        {orgs.slice(0, 8).map((o) => (
          <span
            key={o.login}
            className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-card/30 px-2 py-0.5 font-mono text-[11px]"
          >
            {o.avatarUrl ? (
              <Image
                src={o.avatarUrl}
                alt=""
                width={14}
                height={14}
                unoptimized
                className="size-3.5 rounded-sm"
              />
            ) : null}
            {o.login}
          </span>
        ))}
        {orgs.length > 8 ? (
          <span className="text-muted-foreground/70">
            +{orgs.length - 8} more
          </span>
        ) : null}
      </span>
    </div>
  );
}
