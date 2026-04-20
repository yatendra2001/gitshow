"use client";

import { useState } from "react";

/**
 * PrivacyDrawer — "What was collected?" first-class trust surface.
 *
 * Every authenticated workspace surface should offer this in its
 * footer. Keeps the trust contract explicit: the user sees exactly
 * what we read from GitHub, what we stored, and the one-click path
 * to delete everything.
 *
 * Bottom sheet on narrow screens, right panel on sm+.
 */

export function PrivacyDrawer({
  onDelete,
  className = "",
}: {
  onDelete?: () => Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const confirmDelete = async () => {
    if (!confirmed) {
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 4000);
      return;
    }
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-[12px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline ${className}`}
      >
        What was collected?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Privacy details"
          className="fixed inset-0 z-50 flex items-stretch justify-end"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/60 backdrop-blur-[2px] gs-fade"
          />
          <aside className="relative z-10 w-full sm:max-w-md h-full bg-card border-l border-border/40 shadow-[var(--shadow-float)] gs-enter overflow-y-auto gs-pane-scroll">
            <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border/30 bg-card/95 backdrop-blur">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Privacy
                </div>
                <h3 className="text-[14px] font-medium">What was collected</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </header>
            <div className="px-5 py-4 space-y-5 text-[13px] leading-relaxed">
              <Section title="Scopes we requested">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>
                    <span className="font-mono text-[12px]">read:user</span> —
                    your profile + public activity.
                  </li>
                  <li>
                    <span className="font-mono text-[12px]">user:email</span> —
                    your primary email, so we can ping you when a scan finishes.
                  </li>
                  <li>
                    <span className="font-mono text-[12px]">repo</span> — read
                    access to every repo you've granted, public or private,
                    personal or org (orgs must also approve the app).
                  </li>
                </ul>
                <p className="mt-2 text-[12px] text-muted-foreground/80">
                  Revoke anytime at{" "}
                  <a
                    href="https://github.com/settings/applications"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    github.com/settings/applications
                  </a>
                  .
                </p>
              </Section>
              <Section title="What the scan reads">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Your bio, repos, PRs, and review history.</li>
                  <li>
                    Commit metadata (messages, hashes, authors, timestamps)
                    for the repos you grant — including private and org repos.
                  </li>
                  <li>
                    Readme + source files briefly, while the LLM picks patterns.
                    File contents are never persisted; only the derived claims.
                  </li>
                </ul>
              </Section>
              <Section title="What we store">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>The profile JSON (hook, KPIs, insights, shipped) in Cloudflare R2.</li>
                  <li>Scan progress events in Cloudflare D1 (phase starts/ends, reasoning summaries).</li>
                  <li>Commit/PR/review references so claims can point at evidence.</li>
                </ul>
              </Section>
              <Section title="What we do NOT store">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Source-code file contents from any repo.</li>
                  <li>Anything outside GitHub.</li>
                  <li>Anyone else's private data — only what your grants permit.</li>
                </ul>
              </Section>
              <Section title="Delete everything">
                <p className="text-muted-foreground mb-3">
                  Removes your scans, events, and profile JSON. Keeps your
                  login so you can start over.
                </p>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleting}
                  className={`rounded-xl border px-3 py-2 text-[13px] min-h-11 transition-[color,border-color,background-color] duration-200 ${
                    confirmed
                      ? "border-[var(--destructive)] text-[var(--destructive)] bg-[var(--destructive)]/5"
                      : "border-border/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {deleting
                    ? "Deleting…"
                    : confirmed
                      ? "Tap again to confirm"
                      : "Delete my data"}
                </button>
              </Section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}
