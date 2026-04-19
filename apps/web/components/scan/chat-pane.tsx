"use client";

import * as React from "react";
import type { ProfileCard } from "@gitshow/shared/schemas";
import type { ScanRow } from "@/lib/scans";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import {
  MentionInput,
  type MentionTarget,
  type MentionedClaim,
} from "@/components/scan/mention-input";
import { PromptInputFooterHint } from "@/components/ai-elements/prompt-input";

/**
 * Left pane. Once the scan has succeeded this is a revise chat —
 * every message becomes a POST /api/revise with a resolved claim id
 * (from the @mention) and user guidance.
 *
 * Until then, we show live-update messages ("Starting scan",
 * "Running workers · 3 of 6 done") so the user still has something
 * to read.
 */

export interface ChatMessage {
  id: string;
  from: "user" | "assistant";
  text: string;
}

export function ChatPane({
  scan,
  card,
  partialCard,
  messages,
  onSendRevise,
  revisePending,
}: {
  scan: ScanRow;
  card: ProfileCard | null;
  partialCard: ProfileCard | null;
  messages: ChatMessage[];
  onSendRevise: (payload: {
    claimId: string;
    guidance: string;
  }) => Promise<void>;
  revisePending: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [mentionedClaim, setMentionedClaim] =
    React.useState<MentionedClaim | null>(null);

  const currentCard = card ?? partialCard;
  const canRevise = scan.status === "succeeded" && !revisePending;

  const targets = React.useMemo<MentionTarget[]>(
    () => buildMentionTargets(currentCard),
    [currentCard],
  );

  const suggestions = React.useMemo(() => {
    if (!canRevise) return null;
    return (
      <Suggestions>
        <Suggestion
          onClick={() => {
            setValue("@hook tighten the hook around ownership — drop hackathon framing");
            setMentionedClaim({ id: card?.hook?.id ?? "beat:hook", token: "hook" });
          }}
        >
          Tighten the hook
        </Suggestion>
        <Suggestion
          onClick={() => {
            setValue("@numbers pick numbers that emphasize volume, not awards");
            const first = card?.numbers?.[0];
            if (first) {
              setMentionedClaim({ id: first.id, token: "numbers" });
            }
          }}
        >
          Rewrite the numbers
        </Suggestion>
        <Suggestion
          onClick={() => {
            setValue(
              "@disclosure be more honest about the ship-first reflex — name the next skill",
            );
            const d = card?.disclosure;
            if (d) setMentionedClaim({ id: d.id, token: "disclosure" });
          }}
        >
          Sharpen the disclosure
        </Suggestion>
      </Suggestions>
    );
  }, [canRevise, card]);

  const submit = async ({
    text,
    mention,
  }: {
    text: string;
    mention: MentionedClaim | null;
  }) => {
    if (!canRevise) return;
    if (!text || !mention) return;
    const claimId = resolveClaimId(mention, currentCard);
    if (!claimId) return;
    try {
      await onSendRevise({ claimId, guidance: text });
      setValue("");
      setMentionedClaim(null);
    } catch {
      /* caller surfaces the error via toast; keep the input so the user
       * can retry without retyping. */
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-border">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Tell gitshow how to refine your profile"
              description='Type `@` to target the hero hook, a specific pattern, your KPI numbers, or the disclosure. The LLM re-runs only that beat — usually 2–6 min.'
            />
          ) : (
            messages.map((m) =>
              m.from === "user" ? (
                <Message key={m.id} from="user">
                  <MessageContent>{m.text}</MessageContent>
                </Message>
              ) : (
                <Message key={m.id} from="assistant">
                  <MessageResponse>{m.text}</MessageResponse>
                </Message>
              ),
            )
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border bg-card p-3">
        <MentionInput
          value={value}
          onChange={setValue}
          onSubmit={submit}
          targets={targets}
          mentionedClaim={mentionedClaim}
          onMentionChange={setMentionedClaim}
          suggestions={suggestions}
          disabled={!canRevise}
          placeholder={
            canRevise
              ? "Tell gitshow what to fix. Try @hook or @numbers…"
              : scan.status === "running"
                ? "Scan in progress. You'll be able to revise in a moment."
                : scan.status === "failed"
                  ? "Scan failed. Retry from the dashboard."
                  : "Waiting for scan to finish…"
          }
        />
        <PromptInputFooterHint>
          press ⌨ @ to scope a revise · enter to send · shift+enter for newline
        </PromptInputFooterHint>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function buildMentionTargets(card: ProfileCard | null): MentionTarget[] {
  if (!card) return [];
  const targets: MentionTarget[] = [];
  if (card.hook) {
    targets.push({
      id: card.hook.id,
      token: "hook",
      label: "Hero hook",
      hint: truncate(card.hook.text, 80),
    });
  }
  card.numbers.forEach((n, i) => {
    targets.push({
      id: n.id,
      token: i === 0 ? "numbers" : `number-${i + 1}`,
      label: n.label ?? `Number ${i + 1}`,
      hint: truncate(n.text, 80),
    });
  });
  if (card.disclosure) {
    targets.push({
      id: card.disclosure.id,
      token: "disclosure",
      label: "Disclosure",
      hint: truncate(card.disclosure.text, 80),
    });
  }
  card.patterns.forEach((p, i) => {
    const token = p.id.startsWith("pattern-")
      ? p.id.replace(/^pattern-/, "pattern-")
      : `pattern-${i + 1}`;
    targets.push({
      id: p.id,
      token,
      label: p.label ? `Pattern · ${p.label}` : `Pattern ${i + 1}`,
      hint: truncate(p.text, 80),
    });
  });
  card.shipped.forEach((s) => {
    const projectSlug = s.label
      ? s.label.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 20)
      : s.id;
    targets.push({
      id: s.id,
      token: `shipped-${projectSlug}`,
      label: `Shipped · ${s.label ?? s.id}`,
      hint: truncate(s.text, 80),
    });
  });
  return targets;
}

function resolveClaimId(
  mention: MentionedClaim,
  card: ProfileCard | null,
): string | null {
  if (!card) return null;
  // If the mention id looks like a real claim id, trust it.
  if (mention.id.includes(":") || mention.id.length > 12) return mention.id;
  // Fallback — map beat-level tokens to the first matching claim.
  switch (mention.token) {
    case "hook":
      return card.hook?.id ?? null;
    case "numbers":
      return card.numbers[0]?.id ?? null;
    case "disclosure":
      return card.disclosure?.id ?? null;
    default:
      return mention.id;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
