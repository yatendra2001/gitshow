"use client";

import * as React from "react";
import type { ScanEventEnvelope } from "@gitshow/shared/events";
import { HudPill } from "@/components/ai-elements/context";
import {
  Artifact,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { AgentProgress } from "@/components/scan/agent-progress";
import { ProfileCardView } from "@/components/scan/profile-card";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { Activity as ActivityIcon, Sparkles, AlertCircle } from "lucide-react";

/**
 * Right pane. Three hard states, picked off scan.status:
 *
 *   running / queued → full agent-progress stack, no artifact yet
 *   succeeded        → artifact only (profile card). Revise progress
 *                      lives inline in the chat pane — it doesn't
 *                      belong on the right once the user is iterating.
 *   failed           → a single error card, retry link to the dashboard
 *
 * This keeps each state's right-pane job obvious: the first build is a
 * spectacle, the finished profile is a document, the failure is a
 * cul-de-sac.
 */
export function ProgressPane({
  scan,
  envelopes,
  terminalLines,
  partialCard,
  card,
  highlightClaimId,
  onClaimClick,
}: {
  scan: ScanRow;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
  partialCard: ProfileCard | null;
  card: ProfileCard | null;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
}) {
  const finalCard = card ?? partialCard;

  if (scan.status === "running" || scan.status === "queued") {
    return (
      <RunningView
        scan={scan}
        envelopes={envelopes}
        terminalLines={terminalLines}
      />
    );
  }

  if (scan.status === "succeeded" && finalCard) {
    return (
      <SucceededView
        scan={scan}
        card={finalCard}
        isLive={!!card}
        highlightClaimId={highlightClaimId}
        onClaimClick={onClaimClick}
      />
    );
  }

  if (scan.status === "failed") {
    return <FailedView scan={scan} />;
  }

  // Succeeded but card hasn't loaded yet — show a soft loading state.
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading your profile…
    </div>
  );
}

// ─── Running state — the show ───────────────────────────────────────

function RunningView({
  scan,
  envelopes,
  terminalLines,
}: {
  scan: ScanRow;
  envelopes: ScanEventEnvelope[];
  terminalLines: string[];
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <span className="gs-noise" aria-hidden />

      <div className="flex items-center gap-2 overflow-x-auto border-b border-border/80 px-5 py-2.5 backdrop-blur-sm">
        <HudPill
          icon={<Sparkles />}
          label="status"
          value={scan.status === "queued" ? "Warming up" : "Building your profile"}
        />
        {scan.hiring_verdict && (
          <HudPill
            icon={<ActivityIcon />}
            label="reviewer"
            value={`${scan.hiring_verdict} ${scan.hiring_score ?? "—"}/100`}
          />
        )}
      </div>

      <div className="gs-pane-scroll relative flex-1 overflow-y-auto px-5 py-5">
        <AgentProgress
          envelopes={envelopes}
          terminalLines={terminalLines}
          planStreaming
        />
      </div>
    </div>
  );
}

// ─── Succeeded state — the document ────────────────────────────────

function SucceededView({
  scan,
  card,
  isLive,
  highlightClaimId,
  onClaimClick,
}: {
  scan: ScanRow;
  card: ProfileCard;
  isLive: boolean;
  highlightClaimId?: string | null;
  onClaimClick?: (claimId: string, beat: CardClaim["beat"]) => void;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <Artifact className="flex-1 rounded-none border-0">
        <ArtifactHeader>
          <ArtifactTitle>your profile · @{card.handle}</ArtifactTitle>
          <div className="flex items-center gap-3">
            {scan.hiring_verdict && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                reviewer · {scan.hiring_verdict} {scan.hiring_score ?? "—"}/100
              </span>
            )}
            {isLive && (
              <a
                href={`/p/${card.handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                open public view ↗
              </a>
            )}
          </div>
        </ArtifactHeader>
        <ArtifactContent className="bg-[#FAFAF7]">
          <ProfileCardView
            card={card}
            chrome={false}
            onClaimClick={onClaimClick}
            highlightClaimId={highlightClaimId}
          />
        </ArtifactContent>
      </Artifact>
    </div>
  );
}

// ─── Failed state ──────────────────────────────────────────────────

function FailedView({ scan }: { scan: ScanRow }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="mx-auto mb-3 size-6 text-destructive" />
        <h2 className="mb-2 text-lg font-semibold text-foreground">
          This build didn't land
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          {scan.error ?? "Something went wrong inside the pipeline."}
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/30"
        >
          Back to your scans
        </a>
      </div>
    </div>
  );
}
