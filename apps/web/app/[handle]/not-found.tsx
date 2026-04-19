import Link from "next/link";

export default function HandleNotFound() {
  return (
    <main className="min-h-svh bg-background text-foreground flex items-center">
      <div className="mx-auto w-full max-w-md px-6 py-16 text-center">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-3">
          404
        </div>
        <h1 className="font-[var(--font-serif)] text-[32px] leading-tight mb-3">
          No profile here yet.
        </h1>
        <p className="text-[14px] leading-relaxed text-muted-foreground mb-6">
          This handle hasn't run a gitshow scan. Maybe yours has?
        </p>
        <Link
          href="/app"
          className="inline-flex items-center rounded-xl border border-border/40 bg-card/60 px-4 py-2 text-[13px] hover:bg-card transition-colors"
        >
          Build yours →
        </Link>
      </div>
    </main>
  );
}
