"use client";

import * as React from "react";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { useScanStream } from "@/lib/use-scan-stream";
import { ProgressPane } from "@/components/scan/progress-pane";
import { ChatPane, type ChatMessage } from "@/components/scan/chat-pane";

/**
 * Post-M6 layout:
 *
 *  - `running` / `queued` — 25/75 split. Left is the narration pane so
 *    the user has something to read while the pipeline works; right is
 *    the live AgentProgress.
 *  - `succeeded` — full-width, no chat. The profile IS the interface.
 *    Every claim is click-to-edit (see `editable-text.tsx`). A Publish
 *    button at top-right points `/{handle}` at this scan.
 *  - `failed` / `cancelled` — single-panel error card.
 *
 * The revise-via-AI chat was removed on succeeded — direct edits beat
 * AI rewrites for the kind of fact corrections users make ("my employer
 * is X", "that number is wrong"). The running-state narration still
 * uses the ChatPane shell since the AgentProgress lives on the right.
 */
export function SplitPane({
  scan,
  initialCard,
  initialIsPublished = false,
}: {
  scan: ScanRow;
  initialCard: ProfileCard | null;
  initialIsPublished?: boolean;
}) {
  const { envelopes, terminalLines, connection, isDone } = useScanStream({
    scanId: scan.id,
  });

  const [card, setCard] = React.useState<ProfileCard | null>(initialCard);
  const [effectiveStatus, setEffectiveStatus] = React.useState<
    ScanRow["status"]
  >(scan.status);
  React.useEffect(() => {
    setEffectiveStatus(scan.status);
  }, [scan.status]);
  const [highlightClaimId, setHighlightClaimId] = React.useState<string | null>(
    null,
  );
  const [isPublished, setIsPublished] = React.useState(initialIsPublished);

  // On `done`, flip status + fetch the freshly-emitted card.
  React.useEffect(() => {
    if (!isDone) return;
    setEffectiveStatus((s) =>
      s === "succeeded" || s === "failed" || s === "cancelled" ? s : "succeeded",
    );
    void refreshCard(scan.id).then((next) => {
      if (next) setCard(next);
    });
  }, [isDone, scan.id]);

  // When the initial SSR said "running" but the scan landed after, pull
  // the fresh card so the succeeded view isn't empty.
  React.useEffect(() => {
    if (effectiveStatus !== "succeeded") return;
    if (card && initialCard && card === initialCard) return;
    void refreshCard(scan.id).then((next) => {
      if (next) setCard(next);
    });
  }, [scan.id, effectiveStatus, card, initialCard]);

  // Click-to-pin is only meaningful on running-state (for observation);
  // succeeded-state uses direct inline edits.
  const onClaimClick = (claimId: string, _beat: CardClaim["beat"]) => {
    if (effectiveStatus === "succeeded") return;
    setHighlightClaimId(claimId);
  };

  // Local, optimistic update when a user inline-edits a claim. The
  // EditableText already PATCHed /api/claims/:id and returned; here we
  // just swap the text in local state so the UI reflects without a
  // round-trip refresh.
  const onClaimEdited = React.useCallback(
    (claimId: string, nextText: string) => {
      setCard((prev) => {
        if (!prev) return prev;
        const swap = <T extends CardClaim | null | undefined>(c: T): T =>
          c && c.id === claimId ? ({ ...c, text: nextText } as T) : c;
        return {
          ...prev,
          hook: swap(prev.hook),
          numbers: prev.numbers.map((n) => swap(n)),
          patterns: prev.patterns.map((p) => swap(p)),
          shipped: prev.shipped.map((s) => swap(s)),
          disclosure: swap(prev.disclosure),
        };
      });
    },
    [],
  );

  if (effectiveStatus === "succeeded") {
    return (
      <div className="h-screen w-full">
        <ProgressPane
          scan={{ ...scan, status: effectiveStatus }}
          envelopes={envelopes}
          terminalLines={terminalLines}
          partialCard={null}
          card={card}
          highlightClaimId={highlightClaimId}
          onClaimClick={onClaimClick}
          connection={connection}
          isDone={isDone}
          editable
          onClaimEdited={onClaimEdited}
          isPublished={isPublished}
          onPublishedChange={setIsPublished}
        />
      </div>
    );
  }

  return (
    <div className="grid h-screen w-full grid-cols-[minmax(280px,25%)_1fr]">
      <ChatPane
        scan={scan}
        card={card}
        partialCard={null}
        messages={[] as ChatMessage[]}
        onSendRevise={async () => {
          /* chat-driven revise removed — see docstring */
        }}
        revisePending={false}
        envelopes={envelopes}
        terminalLines={terminalLines}
        reviseStartedAt={null}
      />
      <ProgressPane
        scan={{ ...scan, status: effectiveStatus }}
        envelopes={envelopes}
        terminalLines={terminalLines}
        partialCard={null}
        card={card}
        highlightClaimId={highlightClaimId}
        onClaimClick={onClaimClick}
        connection={connection}
        isDone={isDone}
      />
    </div>
  );
}

async function refreshCard(scanId: string): Promise<ProfileCard | null> {
  try {
    const resp = await fetch(`/api/scan/${scanId}/card`, { cache: "no-store" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { card: ProfileCard };
    return data.card;
  } catch {
    return null;
  }
}
