/**
 * Changelog data — hand-curated from the gitshow repo's commit
 * history (github.com/yatendra2001/gitshow). The raw `git log` is
 * far too noisy to ship as-is: half the commits are infra fixes,
 * Cloudflare debug rounds, or one-off polish. So we group commits
 * by date, translate dev-ese into user-facing bullets, and pick a
 * tag (release, feature, fix, polish) for the eyebrow.
 *
 * When you ship something a user would notice, add a bullet here.
 * Keep entries chronological (newest first). Each entry's `date`
 * is the day work landed; `slug` becomes its anchor (`#YYYY-MM-DD`).
 *
 * The page reads this list directly — no MDX, no remote fetch, no
 * runtime git parsing. Trades freshness for "always works on the
 * edge runtime."
 */

export type ChangelogTag = "release" | "feature" | "fix" | "polish";

export type ChangelogEntry = {
  /** ISO date the work landed. Used for sort + display. */
  date: string;
  /** Short, user-facing title (sentence case, ≤ 60 chars). */
  title: string;
  /** Eyebrow tag — drives the colored chip. */
  tag: ChangelogTag;
  /** 2–6 bullets, written for users not engineers. */
  highlights: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-05-01",
    title: "New landing page + deeper repo reads",
    tag: "release",
    highlights: [
      "Rewrote the marketing site around the actual product — clearer hero, copy, and a new Connect → Review → Share section that morphs through three live console states as you scroll.",
      "Repo scans now read the full source of every selected project instead of capping at 2 KB per file. Smaller repos get read end-to-end; large ones use prioritized batching.",
    ],
  },
  {
    date: "2026-04-30",
    title: "Live billing, $7/mo annual, smarter visitor tracking",
    tag: "release",
    highlights: [
      "Pro is now $10/mo or $7/mo billed annually (a 30% saving). Dodo Payments is in live mode — checkout, renewals, and cancellations are real.",
      "Visitor analytics swapped IP+UA hashing for a first-party cookie (gs_v). Counts are more accurate, and visitors stay anonymous to us.",
      "One-off importer pulls existing Cloudflare web traffic into the analytics dashboard so you can see history from before the cookie rollout.",
      "Fixed country mapping and a long-running 'Top sources' empty-state padding bug.",
    ],
  },
  {
    date: "2026-04-29",
    title: "Custom domains, end to end",
    tag: "feature",
    highlights: [
      "Connect your own domain at yourname.com. We provision SSL via Cloudflare for SaaS, verify ownership through a TXT record, and probe DNS reachability before flipping the switch.",
      "Email confirmation when your domain finally goes live. The dashboard surfaces every step (TXT pre-validation, CF status, retries) so you're never staring at a spinner.",
      "Friendlier copy throughout — the connect flow now talks in plain English, not DNS-speak.",
      "New analytics charts: domain donut + a 2-column sources/domain layout with extra KPIs.",
    ],
  },
  {
    date: "2026-04-27",
    title: "Six templates + an analytics dashboard",
    tag: "release",
    highlights: [
      "Brand-new portfolio chooser: Classic, Spotlight, Glow, Bento, Terminal, Minimal. Switch templates anytime — your content stays put.",
      "Resume export is now a real one-page, ATS-safe PDF. Editor and PDF share the same Inter web font, so what you see is what gets downloaded.",
      "Analytics dashboard ships with views, unique visitors, devices, browsers, top sources, hour-of-day heatmaps, and a world map.",
      "Premium motion system across the dashboard — sidebar persistence, instant nav, streaming analytics, dot-matrix loaders.",
      "Live SSE preview while your scan runs — no more guessing if it's stuck.",
    ],
  },
  {
    date: "2026-04-26",
    title: "Pipeline quality pass + per-repo grounding",
    tag: "feature",
    highlights: [
      "The judge stage now studies every repo with Kimi K2.6, then Sonnet picks the top six. We cap iteration counts so it can't loop forever on a single repo.",
      "Blame attribution: only repos you actually authored work on get attributed to you. External contributions are surfaced separately.",
      "Manifest skills extracted from package.json, Cargo.toml, go.mod, and friends — no more LLM hallucinating frameworks you don't use.",
      "Richer LinkedIn data via ProxyCurl, plus initials-avatar fallbacks when a logo isn't available.",
      "Scan-complete email rewritten in founder voice via React Email.",
    ],
  },
  {
    date: "2026-04-25",
    title: "Streaming progress + identity verification",
    tag: "feature",
    highlights: [
      "The scan page now streams reasoning and tool calls live. You can watch the agent think instead of staring at a phase label.",
      "Hand-tuned matrix loaders for each phase, ShimmeringText labels, hairline cards — the progress UI got the premium subtle treatment.",
      "Cross-verification before trusting user-provided links — no more papers attributed to people who share your name.",
      "Generous fetcher timeouts so a hung blog import can't sink an otherwise good scan.",
      "Structured 'repos to skip' multi-select on intake replaces the free-text textarea.",
    ],
  },
  {
    date: "2026-04-24",
    title: "Private repos, org repos, paywall",
    tag: "feature",
    highlights: [
      "Scan supports private repos, org repos, and drive-by contributions — not just your public starred work.",
      "All features are now gated behind the Dodo subscription. Sign-in is free; running a scan and publishing requires Pro.",
      "Backend pinned to claude-sonnet-4.6 by default — more consistent output than openrouter/auto.",
    ],
  },
  {
    date: "2026-04-22",
    title: "New landing + searchable skill picker",
    tag: "release",
    highlights: [
      "First version of the new marketing site, built around the actual scan flow.",
      "Editor's Skills section now uses a searchable icon picker over a 130-icon registry — no more hand-typing every framework name.",
      "Beautiful 404 + handle-not-found pages with a clear 'create yours' CTA.",
    ],
  },
  {
    date: "2026-04-21",
    title: "Editor, OG images, custom auth",
    tag: "release",
    highlights: [
      "Phase 4 ships the full per-section editor over the draft resume. Edit anything, publish when you're happy.",
      "Phase 5 adds OG images, a sitemap, robots.txt, view tracking, share dialogs, and a live MDX preview.",
      "Auth rewritten with Better Auth on Cloudflare D1 — faster sign-in, fewer middleware foot-guns.",
      "Dashboard at /app is now a real dashboard (not a duplicate of /{handle}). Light/dark toggle on every public profile.",
      "Live progress page replaces the stale /s/{scanId} 404 — phase events stream in real time.",
      "Brand pass: gitshow icon everywhere, light/dark favicon variants, polished OG fallbacks.",
    ],
  },
  {
    date: "2026-04-20",
    title: "M1 → M5 — intake to publish",
    tag: "feature",
    highlights: [
      "M1 — 60-second pre-scan + 3-5 targeted questions before the long scan kicks off.",
      "M2 — the lean public profile at /{handle}, with shadcn charts.",
      "M3 — agency layer: stop a scan, answer agent questions inline, see the critic verdict.",
      "M4 — revise composer rewrite. No mentions, screenshots, or modal fuss; inline progress.",
      "M5 — polish: export, privacy drawer, refresh, delete-profile.",
      "Streaming foundation, structured events, and a humanized phase label system underpins all of it.",
      "Email (Resend) + Web Push scaffold + in-app notification bell.",
    ],
  },
  {
    date: "2026-04-19",
    title: "Web app shell + agent UI overhaul",
    tag: "feature",
    highlights: [
      "First public version of the web app: dark shell, Chain of Thought, Reasoning, Sources, Tool, Queue panes.",
      "Free-form chat replaces the forced @mention syntax for revising claims.",
      "Four rounds of UI polish from real-user feedback — silent-drop chat, auto-bold KPIs, repo recency weighting.",
      "CI/CD: workspace-aware Docker builds, pinned bun, frozen-lockfile fixes, dropped orphaning PR-preview deploys.",
    ],
  },
  {
    date: "2026-04-15",
    title: "First commit",
    tag: "release",
    highlights: [
      "Toy version of the scan pipeline running locally.",
      "Full backend pipeline (intake → scan → judge → claims → portfolio) deployed to the cloud.",
      "Pino logger + session refactor + scripts/CI laid down before the web app got its own repo.",
    ],
  },
];
