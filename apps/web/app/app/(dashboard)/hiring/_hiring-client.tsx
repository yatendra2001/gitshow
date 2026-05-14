"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  OpenToWorkSettings,
  RecruiterInboundRow,
} from "@/lib/bip-data";

interface HiringClientProps {
  initialDiscoverable: boolean;
  initialSettings: OpenToWorkSettings;
  initialInbox: RecruiterInboundRow[];
  portfolioSlug: string;
}

const STATUS_OPTIONS: Array<{
  v: OpenToWorkSettings["status"];
  label: string;
  helper: string;
}> = [
  { v: "looking", label: "Looking", helper: "actively reading inbound" },
  {
    v: "selectively",
    label: "Selectively listening",
    helper: "only the right thing",
  },
  {
    v: "not_looking",
    label: "Not looking",
    helper: "hide everything publicly",
  },
];

export function HiringClient({
  initialDiscoverable,
  initialSettings,
  initialInbox,
  portfolioSlug,
}: HiringClientProps) {
  const router = useRouter();
  const [discoverable, setDiscoverable] = useState(initialDiscoverable);
  const [settings, setSettings] = useState(initialSettings);
  const [inbox, setInbox] = useState(initialInbox);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function saveSettings(patch: Partial<OpenToWorkSettings & { discoverable: boolean }>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/hiring/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            settings?: OpenToWorkSettings;
            discoverable?: boolean;
            error?: string;
          }
        | null;
      if (!res.ok) {
        setError(data?.error ?? `Save failed (${res.status})`);
        setSaving(false);
        return;
      }
      if (data?.settings) setSettings(data.settings);
      if (typeof data?.discoverable === "boolean")
        setDiscoverable(data.discoverable);
      setSaving(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSaving(false);
    }
  }

  async function markInbound(
    id: number,
    status: RecruiterInboundRow["status"],
  ) {
    // Optimistic — flip the row immediately.
    setInbox((prev) =>
      prev
        .map((r) => (r.id === id ? { ...r, status } : r))
        .filter((r) => status !== "spam" || r.id !== id),
    );
    try {
      const res = await fetch(`/api/hiring/inbound/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError(`Update failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  const newCount = inbox.filter((r) => r.status === "new").length;
  const portfolioUrl = `/${portfolioSlug}`;

  return (
    <div className="space-y-10">
      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/[0.04] px-3 py-2 text-[12.5px] text-red-500">
          {error}
        </div>
      ) : null}

      {/* Settings */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-[15px] font-medium">Open-to-work settings</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              These power your portfolio&apos;s public badge + contact form.
            </p>
          </div>
          <Link
            href={portfolioUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11.5px] font-mono text-muted-foreground hover:text-foreground"
          >
            preview ↗
          </Link>
        </div>

        <div className="rounded-lg border border-border/50 bg-card/40 p-5 space-y-5">
          {/* Discoverable */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13.5px] font-medium">Show on portfolio</p>
              <p className="text-[12px] text-muted-foreground">
                Master switch. When off, your portfolio shows no &quot;open to&quot;
                surface regardless of the settings below.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={discoverable}
              onClick={() => saveSettings({ discoverable: !discoverable })}
              disabled={saving}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full",
                "transition-colors duration-200 ease-in-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2",
                discoverable ? "bg-emerald-500" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block size-5 transform rounded-full bg-background shadow-sm",
                  "transition-transform duration-200 ease-in-out mt-0.5 ml-0.5",
                  discoverable ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>

          {/* Status */}
          <Field label="Status">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const active = settings.status === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => saveSettings({ status: opt.v })}
                    disabled={saving}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left",
                      "transition-[background-color,border-color] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                      active
                        ? "border-foreground/40 bg-foreground/[0.06]"
                        : "border-border/40 bg-card/40 hover:border-border/70",
                    )}
                  >
                    <p className="text-[13px] font-medium">{opt.label}</p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                      {opt.helper}
                    </p>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Roles */}
          <Field
            label="Roles you'd consider"
            hint='e.g. "Founding eng · Staff backend · Engineering manager (small team)"'
          >
            <input
              type="text"
              value={settings.roles ?? ""}
              onChange={(e) =>
                setSettings((p) => ({ ...p, roles: e.target.value }))
              }
              onBlur={(e) =>
                e.target.value.trim() !== (initialSettings.roles ?? "")
                  ? saveSettings({ roles: e.target.value })
                  : null
              }
              className={INPUT_CLS}
              placeholder="Founding eng · Staff backend · …"
            />
          </Field>

          {/* Locations */}
          <Field
            label="Locations"
            hint='e.g. "Remote (US/EU) · NYC · SF"'
          >
            <input
              type="text"
              value={settings.locations ?? ""}
              onChange={(e) =>
                setSettings((p) => ({ ...p, locations: e.target.value }))
              }
              onBlur={(e) =>
                e.target.value.trim() !== (initialSettings.locations ?? "")
                  ? saveSettings({ locations: e.target.value })
                  : null
              }
              className={INPUT_CLS}
              placeholder="Remote (US/EU) · NYC · SF"
            />
          </Field>

          {/* Comp */}
          <Field
            label="Comp range (USD, annual)"
            hint="Optional. Helps the inbox triage filter out lowball pitches."
          >
            <div className="flex items-center gap-3">
              <NumberInput
                value={settings.comp_min_usd}
                onChange={(v) => setSettings((p) => ({ ...p, comp_min_usd: v }))}
                onCommit={(v) => saveSettings({ comp_min_usd: v })}
                placeholder="min"
              />
              <span className="text-muted-foreground">—</span>
              <NumberInput
                value={settings.comp_max_usd}
                onChange={(v) => setSettings((p) => ({ ...p, comp_max_usd: v }))}
                onCommit={(v) => saveSettings({ comp_max_usd: v })}
                placeholder="max"
              />
              <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.show_comp}
                  onChange={(e) => saveSettings({ show_comp: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border accent-foreground"
                />
                show publicly
              </label>
            </div>
          </Field>

          {/* Blurb */}
          <Field
            label="Public blurb"
            hint='1–3 sentences shown above the contact form. Plain English, no bullet points.'
          >
            <Textarea
              value={settings.blurb ?? ""}
              onChange={(e) =>
                setSettings((p) => ({ ...p, blurb: e.target.value }))
              }
              onBlur={(e) =>
                e.target.value.trim() !== (initialSettings.blurb ?? "")
                  ? saveSettings({ blurb: e.target.value })
                  : null
              }
              rows={3}
              className="min-h-[80px]"
            />
          </Field>

          {/* Contact email */}
          <Field
            label="Contact email"
            hint="Where to forward inbounds for email-route. Defaults to your account email."
          >
            <input
              type="email"
              value={settings.contact_email ?? ""}
              onChange={(e) =>
                setSettings((p) => ({ ...p, contact_email: e.target.value }))
              }
              onBlur={(e) =>
                e.target.value.trim() !== (initialSettings.contact_email ?? "")
                  ? saveSettings({ contact_email: e.target.value })
                  : null
              }
              className={INPUT_CLS}
              placeholder="you@yourdomain.com"
            />
          </Field>

          <p className="text-[11px] text-muted-foreground">
            Changes save on field blur.
          </p>
        </div>
      </section>

      {/* Inbox */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-[15px] font-medium">Inbox</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              Highest-fit messages first. Spam is auto-routed.
            </p>
          </div>
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {newCount} new · {inbox.length} total
          </span>
        </div>

        {inbox.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              No inbound yet. Once you publish your portfolio and toggle the
              switch on, recruiter messages will land here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {inbox.map((r) => (
              <InboundCard
                key={r.id}
                row={r}
                onAction={(s) => markInbound(r.id, s)}
                busy={isPending || saving}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Saving is best-effort and silent; if you see this disappear, you&apos;re
        synced.
      </p>
    </div>
  );
}

function InboundCard({
  row,
  onAction,
  busy,
}: {
  row: RecruiterInboundRow;
  onAction: (status: RecruiterInboundRow["status"]) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/40 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          "w-full flex items-center justify-between gap-4 px-4 py-3 text-left",
          "transition-colors duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "hover:bg-card",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                row.status === "new"
                  ? "bg-sky-500"
                  : row.status === "replied"
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/40",
              )}
            />
            <p className="text-[13.5px] font-medium truncate">
              {row.from_name}
              {row.from_company ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {row.from_company}
                </span>
              ) : null}
            </p>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground truncate">
            {row.role_title ?? "(no role title)"}
            {row.fit_reason ? <span> · {row.fit_reason}</span> : null}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <FitChip score={row.fit_score} />
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {new Date(row.created_at).toLocaleDateString()}
          </span>
        </div>
      </button>

      {open ? (
        <div className="border-t border-border/40 px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            <Meta label="From" value={`${row.from_name} <${row.from_email}>`} />
            <Meta label="Company" value={row.from_company ?? "—"} />
            <Meta label="Role" value={row.role_title ?? "—"} />
            <Meta label="Comp" value={row.comp_note ?? "—"} />
            <Meta label="Location" value={row.location_note ?? "—"} />
            <Meta
              label="Role link"
              value={
                row.role_link ? (
                  <a
                    href={row.role_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground hover:underline"
                  >
                    open ↗
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Meta label="Fit" value={`${row.fit_score}/100`} />
            <Meta label="Spam" value={`${row.spam_score}/100`} />
          </div>
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">
              Message
            </p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground bg-muted/30 rounded-md px-3 py-2">
              {row.body}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row.status !== "read" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction("read")}
                disabled={busy}
              >
                Mark read
              </Button>
            ) : null}
            {row.status !== "replied" ? (
              <Button
                size="sm"
                onClick={() => onAction("replied")}
                disabled={busy}
              >
                Mark replied
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("archived")}
              disabled={busy}
            >
              Archive
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("spam")}
              disabled={busy}
              className="text-muted-foreground"
            >
              Spam
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FitChip({ score }: { score: number }) {
  const tier =
    score >= 75 ? "high" : score >= 50 ? "mid" : score >= 25 ? "low" : "veryLow";
  const cls = {
    high: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    mid: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    low: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    veryLow: "bg-muted text-muted-foreground border-border",
  }[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
        cls,
      )}
    >
      {score}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[12.5px] font-medium">{label}</label>
        {hint ? (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Meta({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        {label}
      </p>
      <p className="text-[12.5px] text-foreground mt-0.5 truncate">{value}</p>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  onCommit: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      step={1000}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? null : Number(raw));
      }}
      onBlur={() => onCommit(value)}
      className={cn(
        "h-9 w-28 rounded-md border border-border bg-background px-3",
        "text-[13px] tabular-nums placeholder:text-muted-foreground/60",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    />
  );
}

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[13.5px] placeholder:text-muted-foreground/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
