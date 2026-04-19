"use client";

import * as React from "react";
import { toast } from "sonner";
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
    claimId?: string;
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
    if (!canRevise) {
      toast.info(
        scan.status === "running" || scan.status === "queued"
          ? "Hold on — your profile is still being written."
          : "Tweaking opens up once your profile is ready.",
      );
      return;
    }
    if (!text) return;

    // Free-form is the default path now. When the user @mentioned a
    // specific part, we pass claimId so the server skips classification.
    // When they didn't, we send guidance-only and let the server route.
    const claimId = mention ? resolveClaimId(mention, currentCard) : null;
    try {
      await onSendRevise({
        claimId: claimId ?? undefined,
        guidance: text,
      });
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
            canRevise ? (
              <ConversationEmptyState
                title="Want to tweak anything?"
                description="Type @ and pick a part of your profile, then tell gitshow what you'd like to change. Only that piece gets rewritten — the rest stays put."
              />
            ) : scan.status === "running" || scan.status === "queued" ? (
              <ConversationEmptyState
                title="Reading your code…"
                description="Follow along on the right. When it's done you'll be able to tweak any part of your profile from here."
              />
            ) : scan.status === "failed" ? (
              <ConversationEmptyState
                title="That one didn't land"
                description="Head back to your dashboard and try again — retries are free."
              />
            ) : (
              <ConversationEmptyState
                title="Waiting…"
                description="We'll be ready for you in a moment."
              />
            )
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
              ? "Type @ to pick a part, then say what you want…"
              : scan.status === "running"
                ? "You'll be able to tweak things in a moment."
                : scan.status === "failed"
                  ? "Something went wrong. Try again from your dashboard."
                  : "Waiting for your profile to finish…"
          }
        />
        <PromptInputFooterHint>
          @ mentions a part · enter to send · shift+enter for a new line
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
