"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Portfolio "open to work" badge + contact form, self-contained.
 *
 * Drop this into the portfolio layout once. On mount it polls
 * /api/public/hiring/{handle}:
 *   - 404 (not discoverable / not_looking) → renders nothing
 *   - 200 → renders a fixed-corner pill that expands into a modal
 *           contact form
 *
 * No prop wiring to the resume render path — the component
 * fetches on its own so adding the badge doesn't force every
 * template to plumb a new prop.
 */

interface PublicHiringPayload {
  handle: string;
  publicSlug: string;
  status: "looking" | "selectively" | "not_looking";
  roles: string | null;
  locations: string | null;
  blurb: string | null;
  comp: { minUsd: number | null; maxUsd: number | null } | null;
}

const STATUS_LABEL: Record<PublicHiringPayload["status"], string> = {
  looking: "Open to work",
  selectively: "Selectively listening",
  not_looking: "",
};

export function OpenToWorkBadge({ handle }: { handle: string }) {
  const [payload, setPayload] = useState<PublicHiringPayload | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/hiring/${encodeURIComponent(handle)}`, {
      method: "GET",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) return null;
        try {
          return (await r.json()) as PublicHiringPayload;
        } catch {
          return null;
        }
      })
      .then((data) => {
        if (cancelled) return;
        if (!data || data.status === "not_looking") return;
        setPayload(data);
      })
      .catch(() => {
        /* silent — badge just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (!payload) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open contact form"
        className={cn(
          "fixed bottom-4 left-4 z-40 inline-flex items-center gap-2",
          "rounded-full border border-emerald-500/40 bg-emerald-500/10 backdrop-blur",
          "px-3 py-1.5 text-[12px] font-medium text-foreground",
          "shadow-lg shadow-emerald-500/10",
          "transition-transform duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "hover:scale-[1.03] active:scale-[0.97] active:duration-[80ms]",
        )}
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        {STATUS_LABEL[payload.status]}
      </button>

      {open ? (
        <ContactFormModal
          payload={payload}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ContactFormModal({
  payload,
  onClose,
}: {
  payload: PublicHiringPayload;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [roleLink, setRoleLink] = useState("");
  const [compNote, setCompNote] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/hiring/contact/${encodeURIComponent(payload.publicSlug)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_name: name,
            from_email: email,
            from_company: company || null,
            role_title: roleTitle || null,
            role_link: roleLink || null,
            comp_note: compNote || null,
            location_note: locationNote || null,
            body,
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string }
        | null;
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? `Submit failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setSent(true);
      setSubmitting(false);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Network error");
      setSubmitting(false);
    }
  }

  const compRange =
    payload.comp && (payload.comp.minUsd || payload.comp.maxUsd)
      ? `${formatUsd(payload.comp.minUsd)} – ${formatUsd(payload.comp.maxUsd)}`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
      />
      <div
        className={cn(
          "relative w-full sm:max-w-lg max-h-[95vh] overflow-auto",
          "rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-2xl",
          "p-6 sm:p-7",
        )}
      >
        {sent ? (
          <SentScreen onClose={onClose} />
        ) : (
          <>
            <div className="mb-5">
              <h2 className="text-[18px] font-semibold tracking-tight">
                Pitch a role
              </h2>
              {payload.blurb ? (
                <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                  {payload.blurb}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {payload.roles ? <Chip>{payload.roles}</Chip> : null}
                {payload.locations ? <Chip>{payload.locations}</Chip> : null}
                {compRange ? <Chip>{compRange}</Chip> : null}
              </div>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Your name"
                  required
                  value={name}
                  onChange={setName}
                />
                <Input
                  label="Your email"
                  type="email"
                  required
                  value={email}
                  onChange={setEmail}
                />
                <Input
                  label="Company"
                  value={company}
                  onChange={setCompany}
                />
                <Input
                  label="Role title"
                  value={roleTitle}
                  onChange={setRoleTitle}
                  placeholder="Staff backend engineer"
                />
                <Input
                  label="Role link"
                  type="url"
                  value={roleLink}
                  onChange={setRoleLink}
                  placeholder="https://…"
                />
                <Input
                  label="Comp range"
                  value={compNote}
                  onChange={setCompNote}
                  placeholder="$220–260k + 0.5%"
                />
                <Input
                  label="Location"
                  className="sm:col-span-2"
                  value={locationNote}
                  onChange={setLocationNote}
                  placeholder="Remote (US/EU) · NYC HQ"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium block mb-1.5">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  minLength={40}
                  maxLength={6000}
                  rows={6}
                  placeholder="Be specific — what is the role, what stage, what's the case for me, where do you want this to go?"
                  className={cn(
                    "w-full rounded-md border border-border bg-background px-3 py-2",
                    "text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    "placeholder:text-muted-foreground/60",
                  )}
                />
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {body.length}/6000
                </p>
              </div>

              {error ? (
                <p className="text-[12px] text-red-500">{error}</p>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={cn(
                    "rounded-md bg-foreground px-4 py-1.5 text-[12.5px] font-medium text-background",
                    "transition-transform duration-[140ms]",
                    "active:scale-[0.97]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {submitting ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function SentScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="py-6 text-center space-y-3">
      <div className="size-10 rounded-full bg-emerald-500/15 mx-auto inline-flex items-center justify-center">
        <span className="size-2.5 rounded-full bg-emerald-500" />
      </div>
      <h2 className="text-[16px] font-semibold">Message sent.</h2>
      <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
        It&apos;ll show up in their inbox, ranked against their preferences.
        Expect a reply only if it&apos;s a real fit.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium"
      >
        Close
      </button>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11.5px] text-foreground">
      {children}
    </span>
  );
}

function Input({
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  className,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[12px] font-medium block mb-1.5">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-background px-3 text-[13.5px]",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "placeholder:text-muted-foreground/60",
        )}
      />
    </label>
  );
}

function formatUsd(n: number | null): string {
  if (!n) return "—";
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}
