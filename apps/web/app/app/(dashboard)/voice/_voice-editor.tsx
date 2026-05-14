"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { VoiceProfile } from "@/lib/bip-ai";

type SampleKind = "tweet" | "linkedin" | "blog" | "slack" | "other";

interface SampleRow {
  id?: number;
  kind: SampleKind;
  source_url: string | null;
  body: string;
}

interface VoiceEditorProps {
  initialSamples: SampleRow[];
  initialProfile: VoiceProfile | null;
  initialGeneratedAt: number | null;
}

const KIND_LABELS: Record<SampleKind, string> = {
  tweet: "Tweet / X",
  linkedin: "LinkedIn post",
  blog: "Blog excerpt",
  slack: "Slack message",
  other: "Other",
};

const MAX_SAMPLES = 6;
const MIN_BODY_CHARS = 40;

export function VoiceEditor({
  initialSamples,
  initialProfile,
  initialGeneratedAt,
}: VoiceEditorProps) {
  const router = useRouter();
  const [samples, setSamples] = useState<SampleRow[]>(
    initialSamples.length > 0
      ? initialSamples
      : [
          { kind: "tweet", source_url: null, body: "" },
          { kind: "linkedin", source_url: null, body: "" },
        ],
  );
  const [profile, setProfile] = useState<VoiceProfile | null>(initialProfile);
  const [generatedAt, setGeneratedAt] = useState<number | null>(
    initialGeneratedAt,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const validCount = samples.filter((s) => s.body.trim().length >= MIN_BODY_CHARS).length;
  const canSave = validCount >= 2;

  function updateSample(index: number, patch: Partial<SampleRow>) {
    setSamples((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  function addSample() {
    if (samples.length >= MAX_SAMPLES) return;
    setSamples((prev) => [
      ...prev,
      { kind: "tweet", source_url: null, body: "" },
    ]);
  }

  function removeSample(index: number) {
    setSamples((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = samples
        .filter((s) => s.body.trim().length >= MIN_BODY_CHARS)
        .map((s) => ({
          kind: s.kind,
          body: s.body.trim(),
          source_url: s.source_url?.trim() || null,
        }));
      const res = await fetch("/api/voice/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: payload }),
      });
      const data = (await res.json().catch(() => null)) as
        | { profile?: VoiceProfile; error?: string; message?: string }
        | null;
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? `Save failed (${res.status})`);
        setSaving(false);
        return;
      }
      if (data?.profile) {
        setProfile(data.profile);
        setGeneratedAt(Date.now());
      }
      setSaving(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-[15px] font-medium">Writing samples</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              At least 2 samples, each 40+ characters. Real things you posted —
              not aspirational drafts.
            </p>
          </div>
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {validCount}/{samples.length} valid · {samples.length}/{MAX_SAMPLES}
          </span>
        </div>

        <div className="space-y-3">
          {samples.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <KindSelector
                    value={s.kind}
                    onChange={(kind) => updateSample(i, { kind })}
                  />
                  <input
                    type="url"
                    placeholder="Source URL (optional)"
                    value={s.source_url ?? ""}
                    onChange={(e) =>
                      updateSample(i, { source_url: e.target.value || null })
                    }
                    className={cn(
                      "h-8 w-44 sm:w-64 rounded-md border border-border/60 bg-background/60 px-2.5",
                      "text-[12px] placeholder:text-muted-foreground/60",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeSample(i)}
                  className={cn(
                    "text-[11.5px] text-muted-foreground hover:text-foreground",
                    "transition-colors",
                    samples.length <= 1 && "opacity-30 pointer-events-none",
                  )}
                  disabled={samples.length <= 1}
                >
                  Remove
                </button>
              </div>
              <Textarea
                value={s.body}
                onChange={(e) => updateSample(i, { body: e.target.value })}
                placeholder={
                  s.kind === "tweet"
                    ? "Paste a tweet you wrote..."
                    : s.kind === "linkedin"
                      ? "Paste a LinkedIn post..."
                      : "Paste a paragraph or two..."
                }
                rows={5}
                className="min-h-[120px]"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>{s.body.trim().length} chars</span>
                <span
                  className={cn(
                    s.body.trim().length >= MIN_BODY_CHARS
                      ? "text-emerald-500"
                      : "text-muted-foreground/60",
                  )}
                >
                  {s.body.trim().length >= MIN_BODY_CHARS
                    ? "ok"
                    : `${MIN_BODY_CHARS - s.body.trim().length} more chars needed`}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSample}
            disabled={samples.length >= MAX_SAMPLES}
          >
            Add another
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={!canSave || saving || isPending}
          >
            {saving
              ? "Saving + calibrating…"
              : profile
                ? "Re-calibrate voice"
                : "Calibrate voice"}
          </Button>
          {error ? (
            <span className="text-[12px] text-red-500">{error}</span>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-[15px] font-medium mb-3">Voice profile</h2>
        {profile ? (
          <ProfileCard profile={profile} generatedAt={generatedAt} />
        ) : (
          <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              Save your samples to generate a profile. Drafts will be flat and
              templatey until this is calibrated.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function KindSelector({
  value,
  onChange,
}: {
  value: SampleKind;
  onChange: (v: SampleKind) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SampleKind)}
      className={cn(
        "h-8 rounded-md border border-border/60 bg-background/60 px-2",
        "text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {(Object.entries(KIND_LABELS) as [SampleKind, string][]).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

function ProfileCard({
  profile,
  generatedAt,
}: {
  profile: VoiceProfile;
  generatedAt: number | null;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-5 space-y-5">
      <div>
        <ProfileLabel>Tone</ProfileLabel>
        <p className="mt-1.5 text-[14px] text-foreground leading-relaxed">
          {profile.tone}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Sentence length" value={profile.sentenceLength} />
        <Field label="Emoji freq" value={profile.emojiFrequency} />
        <Field
          label="Emojis"
          value={profile.emojis.length > 0 ? profile.emojis.join(" ") : "—"}
        />
        <Field label="Hooks" value={`${profile.hooks.length} captured`} />
      </div>

      {profile.exampleOpening ? (
        <div>
          <ProfileLabel>Example opener</ProfileLabel>
          <p className="mt-1.5 font-mono text-[13px] text-foreground bg-muted/40 px-3 py-2 rounded-md">
            “{profile.exampleOpening}”
          </p>
        </div>
      ) : null}

      <TagList label="Vocabulary tells" items={profile.vocabularyTells} />
      <TagList label="Hooks" items={profile.hooks} mono />
      <TagList label="Things to avoid" items={profile.avoid} variant="muted" />

      {generatedAt ? (
        <p className="text-[11px] text-muted-foreground/70 pt-1">
          Generated {new Date(generatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

function ProfileLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
      {children}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <ProfileLabel>{label}</ProfileLabel>
      <p className="mt-1 text-[13px] font-medium text-foreground capitalize">
        {value}
      </p>
    </div>
  );
}

function TagList({
  label,
  items,
  mono,
  variant,
}: {
  label: string;
  items: string[];
  mono?: boolean;
  variant?: "muted";
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <ProfileLabel>{label}</ProfileLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-0.5 text-[12px]",
              variant === "muted"
                ? "border-border/40 bg-muted/30 text-muted-foreground"
                : "border-border/60 bg-card/60 text-foreground",
              mono && "font-mono text-[11.5px]",
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
