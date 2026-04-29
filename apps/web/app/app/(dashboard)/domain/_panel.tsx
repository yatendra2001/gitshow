"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy02Icon,
  Globe02Icon,
  Loading03Icon,
  ReloadIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/dashboard/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { InstructionSet } from "@/lib/domains/providers";

/**
 * Custom-domain settings panel.
 *
 * States:
 *   1. EMPTY      — no domain row. Input + Connect button + helper.
 *   2. PREVIEW    — input typed, debounced /preview call returns
 *                   provider + instruction card. User reviews + clicks
 *                   "Connect" to commit.
 *   3. SETUP      — row exists in pending/verifying/provisioning.
 *                   Renders the Setup + Verify cards + animated timeline.
 *   4. ACTIVE     — row exists in active. Renders the live banner with
 *                   the open-link, status pill, and the danger-zone
 *                   disconnect button at the bottom.
 *   5. SUSPENDED  — row exists in suspended. Renders an alert + retry.
 *   6. FAILED     — terminal failure with reason + retry / contact.
 *
 * The timeline and motion patterns are aligned with
 * `components/marketing/animations/sections/integration-block.tsx` so
 * the live experience feels like the marketing demo.
 */

interface DomainState {
  id: string;
  hostname: string;
  isApex: boolean;
  apexStrategy: string | null;
  status:
    | "pending"
    | "verifying"
    | "provisioning"
    | "active"
    | "suspended"
    | "failed";
  detectedProvider: string | null;
  providerLabel: string | null;
  verificationToken: string;
  cfSslStatus: string | null;
  failureReason: string | null;
  createdAt: number;
  activatedAt: number | null;
  lastCheckAt: number | null;
}

interface PreviewResult {
  ok: boolean;
  reason?: string;
  message?: string;
  hostname?: string;
  isApex?: boolean;
  apexStrategy?: string | null;
  detectedProvider?: string;
  providerLabel?: string;
  providerHelpUrl?: string | null;
  nameservers?: string[];
  cnameTarget?: string;
  setupCard?: InstructionSet | null;
  verifyCard?: InstructionSet | null;
  citations?: string[];
  sourceTier?: "curated" | "generic" | "ai_generated";
  tombstoneWarning?: { cooldownUntil: number } | null;
}

interface VerifyResponse {
  status: DomainState["status"];
  dns: { ok: boolean; observed: string[] };
  apexRedirect?: { ok: boolean; status: number; location: string | null } | null;
  cf: {
    customHostnameId: string | null;
    sslStatus: string | null;
    userVisible: "provisioning" | "active" | "failed";
    txtName?: string;
    txtValue?: string;
  } | null;
  failureReason: string | null;
  cnameTarget: string;
  hostname: string;
  isApex: boolean;
  apexStrategy: string | null;
}

export function DomainPanel({
  initial,
  cnameTarget,
  publicSlug,
}: {
  initial: DomainState | null;
  cnameTarget: string;
  publicSlug: string;
}) {
  const [domain, setDomain] = useState<DomainState | null>(initial);

  if (!domain) {
    return (
      <EmptyState
        cnameTarget={cnameTarget}
        publicSlug={publicSlug}
        onCreated={(s) => setDomain(s)}
      />
    );
  }
  if (domain.status === "active") {
    return (
      <ActiveState
        domain={domain}
        publicSlug={publicSlug}
        onDisconnected={() => setDomain(null)}
      />
    );
  }
  return (
    <SetupState
      domain={domain}
      cnameTarget={cnameTarget}
      onUpdated={(s) => setDomain(s)}
      onDisconnected={() => setDomain(null)}
    />
  );
}

// ─── EMPTY ────────────────────────────────────────────────────────────

function EmptyState({
  cnameTarget,
  publicSlug,
  onCreated,
}: {
  cnameTarget: string;
  publicSlug: string;
  onCreated: (s: DomainState) => void;
}) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [forceProvider, setForceProvider] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanInput = useMemo(() => input.trim().toLowerCase(), [input]);

  const runPreview = useCallback(
    async (h: string, fp?: string | null) => {
      setLoading(true);
      try {
        const res = await fetch("/api/domains/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hostname: h, forceProvider: fp ?? undefined }),
        });
        const json = (await res.json()) as PreviewResult;
        setPreview(json);
      } catch {
        setPreview({ ok: false, message: "Couldn't preview. Try again." });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced preview as the user types.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (cleanInput.length < 4 || !cleanInput.includes(".")) {
      setPreview(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runPreview(cleanInput, forceProvider);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [cleanInput, forceProvider, runPreview]);

  const onConnect = async () => {
    if (!preview?.ok || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostname: cleanInput,
          forceProvider: forceProvider ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(err?.message ?? "Couldn't connect domain. Try again.");
        return;
      }
      const created = (await res.json()) as DomainState & { hostname: string };
      onCreated({
        id: created.id,
        hostname: created.hostname,
        isApex: created.isApex,
        apexStrategy: created.apexStrategy ?? null,
        status: "pending",
        detectedProvider: created.detectedProvider,
        providerLabel: preview.providerLabel ?? null,
        verificationToken: created.verificationToken,
        cfSslStatus: null,
        failureReason: null,
        createdAt: Date.now(),
        activatedAt: null,
        lastCheckAt: null,
      });
      toast.success("Domain registered. Add the DNS record next.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="px-5 py-4 border-b border-border/40">
          <h2 className="text-[14px] font-semibold tracking-tight">
            Add your domain
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Setup takes 1–5 minutes once you add the DNS record.
          </p>
        </div>
        <div className="px-5 py-5">
          <label
            htmlFor="domain-input"
            className="block text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/80 mb-2"
          >
            Domain
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                id="domain-input"
                type="text"
                inputMode="url"
                placeholder="yatendra.com or portfolio.yatendra.com"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={cn(
                  // Mobile: 16px to prevent iOS zoom (DESIGN.md §6 inputs).
                  // Desktop: drop to 13px to match the rest of the dashboard.
                  "h-10 w-full rounded-md bg-background px-3 text-[16px] sm:text-[13px]",
                  "border border-border/60",
                  "placeholder:text-muted-foreground/60",
                  "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-soft)]",
                  "focus-visible:outline-none focus-visible:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/30",
                )}
              />
              <div
                aria-live="polite"
                className={cn(
                  "absolute right-2 top-1/2 -translate-y-1/2 transition-opacity duration-[140ms]",
                  loading ? "opacity-100" : "opacity-0",
                )}
              >
                <Icon icon={Loading03Icon} className="size-4 text-muted-foreground/70 animate-spin" />
              </div>
            </div>
            <button
              type="button"
              onClick={onConnect}
              disabled={!preview?.ok || submitting}
              className={cn(
                "h-10 inline-flex items-center justify-center gap-1.5 rounded-md px-4 text-[13px] font-medium select-none",
                "bg-primary text-primary-foreground",
                "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_1px_2px_-1px_oklch(0_0_0_/_0.20)]",
                "transition-[background-color,box-shadow,transform,opacity] duration-[140ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                "hover:bg-primary/90 active:scale-[0.97] active:duration-[80ms]",
                "disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              {submitting ? (
                <Icon icon={Loading03Icon} className="size-3.5 animate-spin" />
              ) : null}
              Connect
            </button>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {preview && !preview.ok ? (
              <motion.div
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.215, 0.61, 0.355, 1] }}
                className="mt-3 text-[12px] text-destructive"
              >
                {preview.message ?? "That domain isn't valid."}
              </motion.div>
            ) : null}
            {preview?.ok ? (
              <motion.div
                key="ok"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.215, 0.61, 0.355, 1] }}
                className="mt-4 space-y-3"
              >
                <ProviderChip
                  provider={preview.detectedProvider ?? "unknown"}
                  providerLabel={preview.providerLabel ?? "Unknown"}
                  isApex={preview.isApex ?? false}
                  apexStrategy={preview.apexStrategy ?? null}
                  forceProvider={forceProvider}
                  onForceProvider={setForceProvider}
                />
                <PreviewSummary preview={preview} cnameTarget={cnameTarget} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <p className="mt-5 text-[11.5px] text-muted-foreground/80">
            Your portfolio is also live at{" "}
            <span className="font-mono text-foreground/70">
              gitshow.io/{publicSlug}
            </span>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}

// ─── PREVIEW pieces ──────────────────────────────────────────────────

function ProviderChip({
  provider,
  providerLabel,
  forceProvider,
  onForceProvider,
}: {
  provider: string;
  providerLabel: string;
  isApex: boolean;
  apexStrategy: string | null;
  forceProvider: string | null;
  onForceProvider: (p: string | null) => void;
}) {
  const detectionUnknown = provider === "unknown";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
          detectionUnknown
            ? "bg-foreground/[0.04] text-muted-foreground"
            : "bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/15",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            detectionUnknown ? "bg-muted-foreground/60" : "bg-emerald-500",
          )}
        />
        {detectionUnknown ? "Pick where it's hosted" : `Hosted on ${providerLabel}`}
      </div>
      {detectionUnknown ? (
        <ProviderPicker forceProvider={forceProvider} onForceProvider={onForceProvider} />
      ) : null}
    </div>
  );
}

function ProviderPicker({
  forceProvider,
  onForceProvider,
}: {
  forceProvider: string | null;
  onForceProvider: (p: string | null) => void;
}) {
  const options: Array<{ id: string; label: string }> = [
    { id: "namecheap", label: "Namecheap" },
    { id: "godaddy", label: "GoDaddy" },
    { id: "cloudflare", label: "Cloudflare" },
    { id: "squarespace", label: "Squarespace" },
    { id: "porkbun", label: "Porkbun" },
    { id: "route53", label: "Route 53" },
    { id: "hover", label: "Hover" },
    { id: "name_com", label: "Name.com" },
    { id: "dynadot", label: "Dynadot" },
    { id: "gandi", label: "Gandi" },
  ];
  return (
    <select
      value={forceProvider ?? ""}
      onChange={(e) => onForceProvider(e.target.value || null)}
      className={cn(
        "rounded-md bg-background border border-border/60 px-2 py-1 text-[11.5px]",
        "transition-[border-color] duration-[140ms]",
        "focus-visible:outline-none focus-visible:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/30",
      )}
      aria-label="Pick your DNS provider"
    >
      <option value="">Pick provider…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function PreviewSummary({
  preview,
}: {
  preview: PreviewResult;
  cnameTarget: string;
}) {
  if (!preview.setupCard) return null;
  return (
    <p className="text-[12px] text-muted-foreground leading-relaxed">
      Click <span className="text-foreground font-medium">Connect</span> and
      we'll show you exactly where to add one short line in your DNS settings.
    </p>
  );
}

// ─── SETUP / VERIFYING ─────────────────────────────────────────────

function SetupState({
  domain,
  cnameTarget,
  onUpdated,
  onDisconnected,
}: {
  domain: DomainState;
  cnameTarget: string;
  onUpdated: (s: DomainState) => void;
  onDisconnected: () => void;
}) {
  const [verifyState, setVerifyState] = useState<VerifyResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pollIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runVerify = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await fetch("/api/domains/verify", { method: "POST" });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(err?.message ?? "Couldn't verify. Try again.");
        return;
      }
      const json = (await res.json()) as VerifyResponse;
      setVerifyState(json);
      onUpdated({
        ...domain,
        status: json.status,
        cfSslStatus: json.cf?.sslStatus ?? domain.cfSslStatus,
        failureReason: json.failureReason,
      });
      if (json.status === "active") {
        toast.success("Domain is live. " + json.hostname);
      }
    } finally {
      setVerifying(false);
    }
  }, [domain, onUpdated]);

  // Auto-poll while waiting on DNS / SSL.
  useEffect(() => {
    if (domain.status === "failed") return;
    if (domain.status === "active") return;
    if (pollIdRef.current) clearTimeout(pollIdRef.current);
    pollIdRef.current = setTimeout(() => {
      void runVerify();
    }, 5000);
    return () => {
      if (pollIdRef.current) clearTimeout(pollIdRef.current);
    };
  }, [domain.status, verifyState, runVerify]);

  // ─── First load: kick off one verify so the user sees the timeline.
  useEffect(() => {
    if (!verifyState) {
      void runVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage: TimelineStage =
    domain.status === "active"
      ? "live"
      : verifyState?.cf?.userVisible === "active"
        ? "edge"
        : domain.status === "provisioning"
          ? "ssl"
          : verifyState?.dns.ok
            ? "ssl"
            : "dns";

  return (
    <div className="space-y-6">
      {/* Header banner with hostname + status */}
      <div className="rounded-xl border border-border/40 bg-card/40 px-5 py-4 flex items-center gap-3">
        <Icon icon={Globe02Icon} className="size-5 text-foreground/80" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium tracking-tight truncate">
            {domain.hostname}
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {statusBlurb(domain.status, verifyState)}
          </div>
        </div>
        <StatusPill status={domain.status} />
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight">Setup</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Usually 1–5 minutes. We'll check automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={runVerify}
            disabled={verifying}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 h-8 text-[12px] font-medium",
              "border border-border/60 bg-background hover:bg-foreground/[0.04]",
              "transition-[background-color,border-color,transform] duration-[140ms]",
              "active:scale-[0.97] active:duration-[80ms]",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              verifying && "opacity-60 pointer-events-none",
            )}
          >
            <Icon
              icon={ReloadIcon}
              className={cn("size-3.5", verifying && "animate-spin")}
            />
            Check now
          </button>
        </div>
        <div className="px-5 py-5">
          <Timeline stage={stage} />
        </div>
      </Card>

      {/* What you need to do */}
      <SetupInstructions
        domain={domain}
        verifyState={verifyState}
        cnameTarget={cnameTarget}
      />

      <DangerZone hostname={domain.hostname} onDisconnected={onDisconnected} />
    </div>
  );
}

function statusBlurb(
  status: DomainState["status"],
  v: VerifyResponse | null,
): string {
  if (status === "failed") return "Something went wrong. We can help.";
  if (status === "suspended") return "Your domain stopped pointing here. Check your DNS settings.";
  if (status === "active") return "Live.";
  if (v?.cf?.userVisible === "active") return "Almost there. Going live in a moment…";
  if (status === "provisioning") return "Got your domain. Securing it now…";
  if (v?.dns.ok) return "Got your domain. Securing it now…";
  return "Waiting for your DNS record. We'll detect it automatically.";
}

// ─── Timeline ────────────────────────────────────────────────────────

type TimelineStage = "dns" | "ssl" | "edge" | "live";

const TIMELINE_STEPS: Array<{ key: TimelineStage; label: string; detail: string }> = [
  { key: "dns", label: "Connecting", detail: "Picking up your domain" },
  { key: "ssl", label: "Securing", detail: "Issuing your certificate" },
  { key: "edge", label: "Optimizing", detail: "Speeding it up worldwide" },
  { key: "live", label: "Live", detail: "Your portfolio is online" },
];

const STAGE_INDEX: Record<TimelineStage, number> = {
  dns: 0,
  ssl: 1,
  edge: 2,
  live: 3,
};

function Timeline({ stage }: { stage: TimelineStage }) {
  const idx = STAGE_INDEX[stage];
  return (
    <ol className="relative space-y-3 pl-7">
      <span
        aria-hidden
        className="absolute left-2 top-2 bottom-2 w-px bg-border/60"
      />
      {TIMELINE_STEPS.map((step, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={step.key} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute left-[-22px] top-[3px] grid place-items-center size-4 rounded-full ring-2 ring-background",
                done
                  ? "bg-emerald-500"
                  : current
                    ? "bg-foreground"
                    : "bg-foreground/[0.10]",
              )}
            >
              {done ? (
                <Icon
                  icon={Tick02Icon}
                  className="size-2.5 text-white"
                  strokeWidth={3}
                />
              ) : current ? (
                <span className="size-1.5 rounded-full bg-background motion-safe:animate-pulse" />
              ) : null}
            </span>
            <div className="text-[13px] font-medium leading-tight">
              {step.label}
              {current ? (
                <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                  in progress…
                </span>
              ) : null}
            </div>
            <div className="text-[11.5px] text-muted-foreground/90 mt-0.5">
              {step.detail}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Setup instructions card ────────────────────────────────────────

function SetupInstructions({
  domain,
  verifyState,
  cnameTarget,
}: {
  domain: DomainState;
  verifyState: VerifyResponse | null;
  cnameTarget: string;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/domains/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostname: domain.hostname,
            forceProvider: domain.detectedProvider ?? undefined,
          }),
        });
        if (res.ok) setPreview((await res.json()) as PreviewResult);
      } catch {
        // ignore
      }
    })();
  }, [domain.hostname, domain.detectedProvider]);

  const setup = preview?.setupCard;
  const verify = preview?.verifyCard;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Add this to your DNS"
          subtitle="One record. Copy and paste."
        />
        <div className="px-5 py-4">
          {setup ? (
            <InstructionStepsList card={setup} cnameTarget={cnameTarget} />
          ) : (
            <Skeleton />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Confirm it's yours"
          subtitle="One quick check, then we go live."
        />
        <div className="px-5 py-4">
          {verifyState?.cf?.txtName && verifyState?.cf?.txtValue ? (
            <VerificationCard
              host={verifyState.cf.txtName}
              value={verifyState.cf.txtValue}
              providerLabel={domain.providerLabel ?? "your DNS"}
            />
          ) : verify ? (
            <InstructionStepsList card={verify} cnameTarget={cnameTarget} />
          ) : (
            <p className="text-[12px] text-muted-foreground">
              We'll show this once your first record lands.
            </p>
          )}
        </div>
      </Card>

      {preview?.sourceTier === "ai_generated" && preview.citations?.length ? (
        <p className="text-[10.5px] text-muted-foreground/70">
          Auto-generated for your provider.{" "}
          <FeedbackButtons
            provider={domain.detectedProvider ?? "unknown"}
            kind={setup?.kind ?? "cname_subdomain"}
          />
        </p>
      ) : null}
    </div>
  );
}

function InstructionStepsList({
  card,
  cnameTarget: _cnameTarget,
}: {
  card: InstructionSet;
  cnameTarget: string;
}) {
  return (
    <ol className="space-y-2.5">
      {card.steps.map((step, i) => (
        <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed">
          <span className="grid place-items-center size-5 shrink-0 rounded-full bg-foreground/[0.04] text-[10.5px] font-medium text-muted-foreground/80 mt-0.5">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-foreground/90">{step.text}</p>
            {step.copyValue ? (
              <CopyChip value={step.copyValue} />
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function VerificationCard({
  host,
  value,
  providerLabel,
}: {
  host: string;
  value: string;
  providerLabel: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">
        Add one more record on {providerLabel}.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Type" value="TXT" />
        <Field label="Name" value={host} copy />
        <div className="sm:col-span-2">
          <Field label="Value" value={value} copy />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-card/30 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground/80">
        {label}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] text-foreground truncate">{value}</span>
        {copy ? <CopyButton value={value} /> : null}
      </div>
    </div>
  );
}

function CopyChip({ value }: { value: string }) {
  return (
    <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.04] pl-2 pr-1 py-0.5">
      <span className="font-mono text-[11.5px] text-foreground truncate max-w-[28ch]">
        {value}
      </span>
      <CopyButton value={value} small />
    </div>
  );
}

function CopyButton({ value, small }: { value: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy. Long-press the value instead.");
        }
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]",
        "transition-[background-color,color,transform] duration-[140ms]",
        "active:scale-[0.92] active:duration-[80ms]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        small ? "size-5" : "size-7",
      )}
      aria-label="Copy"
    >
      <Icon
        icon={copied ? CheckmarkCircle02Icon : Copy02Icon}
        className={cn(small ? "size-3" : "size-3.5")}
      />
    </button>
  );
}

function FeedbackButtons({ provider, kind }: { provider: string; kind: string }) {
  const [submitted, setSubmitted] = useState<"y" | "n" | null>(null);
  const send = async (helpful: boolean) => {
    if (submitted) return;
    setSubmitted(helpful ? "y" : "n");
    void fetch("/api/domains/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, kind, helpful }),
    }).catch(() => null);
  };
  if (submitted) {
    return <span>Thanks for letting us know.</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      Worked for you?{" "}
      <button
        type="button"
        onClick={() => send(true)}
        className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
      >
        Yes
      </button>
      <span>·</span>
      <button
        type="button"
        onClick={() => send(false)}
        className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
      >
        Not quite
      </button>
    </span>
  );
}

// ─── ACTIVE ─────────────────────────────────────────────────────────

function ActiveState({
  domain,
  publicSlug: _publicSlug,
  onDisconnected,
}: {
  domain: DomainState;
  publicSlug: string;
  onDisconnected: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-4 flex items-center gap-3">
        <span
          aria-hidden
          className="grid place-items-center size-7 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        >
          <Icon icon={CheckmarkCircle02Icon} className="size-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold tracking-tight truncate">
            {domain.hostname} is live
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            Live since{" "}
            {domain.activatedAt
              ? new Date(domain.activatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "just now"}
          </div>
        </div>
        <a
          href={`https://${domain.hostname}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 h-8 text-[12px] font-medium",
            "border border-border/50 bg-card/60 hover:bg-card",
            "transition-[background-color,border-color,transform] duration-[140ms]",
            "active:scale-[0.97] active:duration-[80ms]",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          )}
        >
          Open
          <Icon icon={ArrowUpRight01Icon} className="size-3" />
        </a>
      </div>

      <DangerZone hostname={domain.hostname} onDisconnected={onDisconnected} />
    </div>
  );
}

// ─── DANGER ZONE ────────────────────────────────────────────────────

function DangerZone({
  hostname,
  onDisconnected,
}: {
  hostname: string;
  onDisconnected: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  return (
    <Card>
      <div className="px-5 py-4 border-b border-border/40">
        <h2 className="text-[14px] font-semibold tracking-tight">Disconnect</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          Take {hostname} off your portfolio.
        </p>
      </div>
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          You can reconnect anytime.
        </p>
        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex items-center gap-1 rounded-md px-2.5 h-8 text-[12px] font-medium border border-border/60 hover:bg-foreground/[0.04] transition-colors"
            >
              <Icon icon={Cancel01Icon} className="size-3" />
              Cancel
            </button>
            <button
              type="button"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                try {
                  const res = await fetch("/api/domains", { method: "DELETE" });
                  if (!res.ok) {
                    toast.error("Couldn't disconnect. Try again.");
                    return;
                  }
                  toast.success("Disconnected.");
                  onDisconnected();
                } finally {
                  setWorking(false);
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 h-8 text-[12px] font-medium",
                "bg-destructive text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10)]",
                "hover:bg-destructive/90 active:scale-[0.97] active:duration-[80ms] transition-[background-color,transform] duration-[140ms]",
                working && "opacity-60 pointer-events-none",
              )}
            >
              {working ? (
                <Icon icon={Loading03Icon} className="size-3 animate-spin" />
              ) : null}
              Confirm disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 h-8 text-[12px] font-medium border border-border/60 hover:bg-destructive/[0.06] hover:text-destructive hover:border-destructive/30 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>
    </Card>
  );
}

// ─── Building blocks ────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/40 bg-card/40 overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-5 py-4 border-b border-border/40">
      <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function StatusPill({ status }: { status: DomainState["status"] }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/15"
      : status === "failed"
        ? "bg-destructive/[0.08] text-destructive ring-1 ring-destructive/15"
        : status === "suspended"
          ? "bg-amber-500/[0.10] text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/15"
          : "bg-foreground/[0.04] text-muted-foreground ring-1 ring-foreground/[0.06]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      <span aria-hidden className={cn(
        "size-1.5 rounded-full",
        status === "active"
          ? "bg-emerald-500"
          : status === "failed"
            ? "bg-destructive"
            : status === "suspended"
              ? "bg-amber-500"
              : "bg-muted-foreground/60",
      )} />
      {labelFor(status)}
    </span>
  );
}

function labelFor(s: DomainState["status"]): string {
  switch (s) {
    case "pending":
    case "verifying":
      return "Setting up";
    case "provisioning":
      return "Securing";
    case "active":
      return "Live";
    case "suspended":
      return "Paused";
    case "failed":
      return "Needs attention";
  }
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-3/4 rounded bg-foreground/[0.04] animate-pulse" />
      <div className="h-3 w-2/4 rounded bg-foreground/[0.04] animate-pulse" />
      <div className="h-3 w-3/5 rounded bg-foreground/[0.04] animate-pulse" />
    </div>
  );
}
