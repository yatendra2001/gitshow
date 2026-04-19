"use client";

import * as React from "react";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import type { ScanRow } from "@/lib/scans";
import type { ProfileCard, CardClaim } from "@gitshow/shared/schemas";
import { useScanStream } from "@/lib/use-scan-stream";
import { ChatPane, type ChatMessage } from "@/components/scan/chat-pane";
import { ProgressPane } from "@/components/scan/progress-pane";

/**
 * The Claude-style builder. Left is chat (revise), right is progress +
 * live artifact. Driven by the hybrid realtime stream (WS + poll).
 *
 * Client component because we subscribe to live events; the parent
 * server component provides the initial scan + card snapshot.
 */
export function SplitPane({
  scan,
  initialCard,
}: {
  scan: ScanRow;
  initialCard: ProfileCard | null;
}) {
  const { envelopes, terminalLines } = useScanStream({ scanId: scan.id });

  const [card, setCard] = React.useState<ProfileCard | null>(initialCard);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [revisePending, setRevisePending] = React.useState<{
    title: string;
  } | null>(null);
  const [highlightClaimId, setHighlightClaimId] = React.useState<string | null>(
    null,
  );

  // When a scan finishes or a revise completes, refetch the card from R2.
  React.useEffect(() => {
    if (scan.status !== "succeeded") return;
    if (card && initialCard && card === initialCard) {
      // already have it from the server
      return;
    }
    void refreshCard(scan.id).then((next) => {
      if (next) setCard(next);
    });
  }, [scan.id, scan.status, card, initialCard]);

  // If a revise stage-end event arrives, refetch + show it.
  React.useEffect(() => {
    const latestReviseEnd = [...envelopes]
      .reverse()
      .find(
        (e) =>
          e.event.kind === "stage-end" &&
          "stage" in e.event &&
          e.event.stage === "revise-claim",
      );
    if (!latestReviseEnd) return;
    setRevisePending(null);
    void refreshCard(scan.id).then((next) => {
      if (next) {
        setCard(next);
        setMessages((prev) => [
          ...prev,
          {
            id: nanoid(8),
            from: "assistant",
            text: "Updated. The artifact on the right now reflects the change.",
          },
        ]);
      }
    });
  }, [envelopes, scan.id]);

  const onClaimClick = (claimId: string, beat: CardClaim["beat"]) => {
    setHighlightClaimId(claimId);
    toast(`Pinned @${beat}`, {
      description: "Type your guidance below, then send to revise.",
      duration: 3000,
    });
  };

  const onSendRevise = async ({
    claimId,
    guidance,
  }: {
    claimId: string;
    guidance: string;
  }) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nanoid(8),
        from: "user",
        text: guidance,
      },
    ]);

    const resp = await fetch("/api/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId: scan.id,
        claimId,
        guidance,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      toast.error(`Revise failed: ${body.slice(0, 140)}`);
      setMessages((prev) => [
        ...prev,
        {
          id: nanoid(8),
          from: "assistant",
          text: `Couldn't start revise: ${body.slice(0, 140)}`,
        },
      ]);
      throw new Error(body);
    }

    setRevisePending({ title: `Revising @${claimId.split(":")[0]}` });
    setMessages((prev) => [
      ...prev,
      {
        id: nanoid(8),
        from: "assistant",
        text: "Spawning a fly machine to re-run that beat. Usually 2–6 min.",
      },
    ]);
  };

  return (
    <div className="grid h-screen w-full grid-cols-[minmax(340px,40%)_1fr]">
      <ChatPane
        scan={scan}
        card={card}
        partialCard={null}
        messages={messages}
        onSendRevise={onSendRevise}
        revisePending={!!revisePending}
      />
      <ProgressPane
        scan={scan}
        envelopes={envelopes}
        terminalLines={terminalLines}
        partialCard={null}
        card={card}
        highlightClaimId={highlightClaimId}
        onClaimClick={onClaimClick}
        revisePending={revisePending}
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
