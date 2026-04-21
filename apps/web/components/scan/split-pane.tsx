"use client";

import * as React from "react";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { useScanStream } from "@/lib/use-scan-stream";
import { ProgressPane } from "@/components/scan/progress-pane";

/**
 * Single-column shell for the scan page. Renders full-width
 * ProgressPane across all scan states — running, succeeded, failed.
 *
 * The revise-via-AI chat (previously on the left in a 25/75 split)
 * has been removed. Users edit the rendered profile directly via
 * click-to-edit (see `editable-text.tsx`), and the publish/preview
 * surface IS the editor.
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
  const [isPublished, setIsPublished] = React.useState(initialIsPublished);
  // Timestamp of the last successful edit/delete — drives the
  // "Saved · Xs ago" chip in the header so the user has visible
  // confidence their inline edits actually landed.
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);

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

  // Local, optimistic update when a user inline-edits a claim.
  // EditableText already PATCHed /api/claims/:id; we just swap the
  // text in local state so the UI reflects without a refresh.
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
      setLastSavedAt(Date.now());
    },
    [],
  );

  // Local, optimistic drop when a claim is removed. DELETE
  // /api/claims/:id has already fired and returned OK; we just pull
  // the item out of local state so the UI reflects the removal.
  const onClaimRemoved = React.useCallback((claimId: string) => {
    setCard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hook: prev.hook && prev.hook.id === claimId ? null : prev.hook,
        numbers: prev.numbers.filter((n) => n.id !== claimId),
        patterns: prev.patterns.filter((p) => p.id !== claimId),
        shipped: prev.shipped.filter((s) => s.id !== claimId),
        disclosure:
          prev.disclosure && prev.disclosure.id === claimId
            ? null
            : prev.disclosure,
      };
    });
    setLastSavedAt(Date.now());
  }, []);

  return (
    <div className="h-screen w-full">
      <ProgressPane
        scan={{ ...scan, status: effectiveStatus }}
        envelopes={envelopes}
        terminalLines={terminalLines}
        partialCard={null}
        card={card}
        connection={connection}
        isDone={isDone}
        editable={effectiveStatus === "succeeded"}
        onClaimEdited={onClaimEdited}
        onClaimRemoved={onClaimRemoved}
        isPublished={isPublished}
        onPublishedChange={setIsPublished}
        lastSavedAt={lastSavedAt}
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
