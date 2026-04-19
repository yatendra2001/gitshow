"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * /s/new — first message of a new conversation. The user hands over
 * their GitHub handle + any context, we POST /api/scan, Fly spawns a
 * machine, and we redirect into /s/[id] where the split pane takes
 * over.
 */
export default function NewScanPage() {
  const router = useRouter();
  const [handle, setHandle] = React.useState("");
  const [context, setContext] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    setBusy(true);
    try {
      const resp = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim(),
          context_notes: context.trim() || undefined,
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        toast.error(`Couldn't start scan: ${err.slice(0, 200)}`);
        return;
      }
      const data = (await resp.json()) as { scanId: string };
      router.push(`/s/${data.scanId}`);
    } catch (err) {
      toast.error(`Network error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <Link
          href="/dashboard"
          className="mb-8 flex items-center gap-2 no-underline"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground font-mono text-xs font-bold text-background">
            g
          </div>
          <span className="text-sm font-bold tracking-tight">
            gitshow<span className="text-muted-foreground">.io</span>
          </span>
        </Link>

        <h1 className="mb-3 font-serif text-3xl leading-tight tracking-tight">
          Start a scan
        </h1>
        <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
          Hand over the GitHub handle whose git history gitshow should
          read. First scans take ~20–45 minutes; you'll see every phase
          land live in the right pane.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              GitHub handle
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
              <Github className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">github.com/</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="yatendra2001"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                required
                pattern="[a-zA-Z0-9-]+"
                maxLength={39}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Context (optional)
            </label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              placeholder="Anything you want the pipeline to emphasize — a title, a role, a specific project to lead with. GitShow will fold this in."
              maxLength={2000}
            />
            <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
              {context.length}/2000
            </div>
          </div>

          <Button
            type="submit"
            disabled={busy || !handle.trim()}
            size="lg"
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Spinning up…
              </>
            ) : (
              <>
                Start scan
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>

          <p className="pt-2 text-center text-[11px] text-muted-foreground">
            Typical cost: $8–$12 per scan · 25–45 min wall-clock
          </p>
        </form>
      </main>
      <Toaster richColors position="bottom-center" />
    </>
  );
}
