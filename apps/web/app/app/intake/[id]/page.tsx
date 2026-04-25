"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

/**
 * /app/intake/[id]
 *
 * URL-collection step before the full scan. The user pastes their
 * LinkedIn / personal site / Twitter / blog URLs and (optionally)
 * unticks any repos they don't want featured. Submitting POSTs to
 * /api/intake/[id]/answers, which spawns the scan and returns a
 * scanId for the redirect.
 *
 * Mobile-first — single column, generous tap targets (≥44px).
 */

interface ProfileInputs {
  linkedin: string;
  twitter: string;
  website: string;
  youtube: string;
  orcid: string;
  stackoverflow: string;
  blogUrls: string[];
  /** Full names ("owner/name") of repos the user wants the scan to skip. */
  skipRepos: string[];
}

const EMPTY_INPUTS: ProfileInputs = {
  linkedin: "",
  twitter: "",
  website: "",
  youtube: "",
  orcid: "",
  stackoverflow: "",
  blogUrls: [""],
  skipRepos: [],
};

/** Compact owned-repo metadata from /api/intake/[id]/repos. */
interface RepoOption {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stars: number;
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
}

export default function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [inputs, setInputs] = useState<ProfileInputs>(EMPTY_INPUTS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);

  // Repo list for the "Repos to skip" multi-select. Fired once on
  // mount; failure is surfaced inline but doesn't block submission
  // (user can still complete intake without skipping anything).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(
          `/api/intake/${encodeURIComponent(id)}/repos`,
          { cache: "no-store" },
        );
        const data = (await resp.json().catch(() => ({}))) as {
          repos?: RepoOption[];
          detail?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!resp.ok || !data.repos) {
          setReposError(data.detail ?? data.error ?? "Couldn't load repos.");
          return;
        }
        setRepos(data.repos);
      } catch (err) {
        if (cancelled) return;
        setReposError(err instanceof Error ? err.message : "Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const trimmed = (v: string) => v.trim();
    // Server demands real http(s) URLs for linkedin/website/youtube/blogs.
    // Accept bare hosts like `linkedin.com/in/foo` by prepending https://.
    const normalizeUrl = (v: string) => {
      const t = v.trim();
      if (!t) return "";
      return /^https?:\/\//i.test(t) ? t : `https://${t}`;
    };
    const cleanBlogs = inputs.blogUrls
      .map(normalizeUrl)
      .filter((u) => u.length > 0)
      .slice(0, 5);
    const socials: {
      linkedin?: string;
      twitter?: string;
      website?: string;
      youtube?: string;
      orcid?: string;
      stackoverflow?: string;
    } = {};
    if (trimmed(inputs.linkedin)) socials.linkedin = normalizeUrl(inputs.linkedin);
    if (trimmed(inputs.twitter)) socials.twitter = trimmed(inputs.twitter);
    if (trimmed(inputs.website)) socials.website = normalizeUrl(inputs.website);
    if (trimmed(inputs.youtube)) socials.youtube = normalizeUrl(inputs.youtube);
    if (trimmed(inputs.orcid)) socials.orcid = normalizeUrl(inputs.orcid);
    if (trimmed(inputs.stackoverflow))
      socials.stackoverflow = normalizeUrl(inputs.stackoverflow);

    try {
      const resp = await fetch(
        `/api/intake/${encodeURIComponent(id)}/answers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            socials: Object.keys(socials).length > 0 ? socials : undefined,
            blog_urls: cleanBlogs.length > 0 ? cleanBlogs : undefined,
            skip_repos:
              inputs.skipRepos.length > 0 ? inputs.skipRepos : undefined,
          }),
        },
      );
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as {
          error?: string;
          issues?: Array<{ path?: Array<string | number>; message?: string }>;
        };
        // "invalid body" is useless to users. If the server returned
        // zod issues, show the first field + message instead.
        const issue = err.issues?.[0];
        if (err.error === "invalid body" && issue) {
          const field = issue.path?.join(".") ?? "input";
          setSubmitError(`${field}: ${issue.message ?? "invalid value"}`);
        } else {
          setSubmitError(err.error ?? "Something went wrong.");
        }
        return;
      }
      // Land directly on the live progress view for the new scan.
      const data = (await resp.json().catch(() => ({}))) as { scanId?: string };
      if (data.scanId) {
        router.push(`/app/scan/${data.scanId}`);
      } else {
        router.push("/app");
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [inputs, submitting, id, router]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
        <header className="mb-8">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground/80 mb-2">
            Tell us where to look
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-tight">
            Where should we look?
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            Paste any links that show your work — LinkedIn, personal site,
            blog. We&apos;ll start the scan as soon as you hit Start.
          </p>
        </header>

        <div className="flex flex-col gap-6">
          <ProfileInputsCard inputs={inputs} onChange={setInputs} />
          <SkipReposCard
            inputs={inputs}
            onChange={setInputs}
            repos={repos}
            error={reposError}
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {submitError ? (
              <span className="text-[12px] text-[var(--destructive)] sm:mr-auto">
                {submitError}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-xl bg-foreground text-background px-5 py-3 text-[14px] font-medium shadow-[var(--shadow-card)] transition-opacity duration-200 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed min-h-11"
            >
              {submitting ? "Starting scan…" : "Start scan"}
            </button>
          </div>
          <p className="text-[12px] text-muted-foreground/80">
            The scan takes 40–50 minutes. We&apos;ll email you when it&apos;s
            ready.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────

function ProfileInputsCard({
  inputs,
  onChange,
}: {
  inputs: ProfileInputs;
  onChange: (next: ProfileInputs) => void;
}) {
  const set = <K extends keyof ProfileInputs>(key: K, value: ProfileInputs[K]) =>
    onChange({ ...inputs, [key]: value });

  const setBlog = (i: number, value: string) => {
    const next = [...inputs.blogUrls];
    next[i] = value;
    onChange({ ...inputs, blogUrls: next });
  };

  const addBlog = () => {
    if (inputs.blogUrls.length >= 5) return;
    onChange({ ...inputs, blogUrls: [...inputs.blogUrls, ""] });
  };

  const removeBlog = (i: number) => {
    const next = inputs.blogUrls.filter((_, j) => j !== i);
    onChange({
      ...inputs,
      blogUrls: next.length > 0 ? next : [""],
    });
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6 shadow-[var(--shadow-card)]">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Links &amp; socials · optional
      </div>
      <h2 className="text-[15px] sm:text-[16px] font-medium leading-snug">
        Where your work lives
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        LinkedIn lets us build your work &amp; education sections. Blog URLs
        get imported verbatim into the portfolio.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InputField
          label="LinkedIn URL"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={inputs.linkedin}
          onChange={(v) => set("linkedin", v)}
        />
        <InputField
          label="Twitter / X handle or URL"
          placeholder="@yourhandle"
          value={inputs.twitter}
          onChange={(v) => set("twitter", v)}
        />
        <InputField
          label="Personal site"
          placeholder="https://you.dev"
          value={inputs.website}
          onChange={(v) => set("website", v)}
        />
        <InputField
          label="YouTube"
          placeholder="https://youtube.com/@yourhandle"
          value={inputs.youtube}
          onChange={(v) => set("youtube", v)}
        />
        <InputField
          label="ORCID iD"
          placeholder="https://orcid.org/0000-0000-0000-0000"
          value={inputs.orcid}
          onChange={(v) => set("orcid", v)}
        />
        <InputField
          label="Stack Overflow"
          placeholder="https://stackoverflow.com/users/123456/you"
          value={inputs.stackoverflow}
          onChange={(v) => set("stackoverflow", v)}
        />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <label className="text-[12px] text-foreground font-medium">
            Blog / article URLs <span className="text-muted-foreground">· up to 5</span>
          </label>
          {inputs.blogUrls.length < 5 ? (
            <button
              type="button"
              onClick={addBlog}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              + Add another
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Paste Medium / dev.to / Substack / Hashnode / personal-site post
          URLs. We&apos;ll fetch and host them with a canonical link back.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {inputs.blogUrls.map((url, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setBlog(i, e.target.value)}
                placeholder={
                  i === 0
                    ? "https://medium.com/@you/my-best-post"
                    : "https://..."
                }
                className="flex-1 rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-11"
              />
              {inputs.blogUrls.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeBlog(i)}
                  aria-label={`Remove blog URL ${i + 1}`}
                  className="rounded-xl border border-border/40 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:border-border transition-colors min-h-11"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-11"
      />
    </label>
  );
}

/**
 * Repos to skip — search-and-multi-select picker. Selected chips
 * render at the top; the searchable list below filters by name +
 * description. We pre-sort by pushed_at desc so the freshest repos
 * surface first — that's where users' "experiments" tend to live.
 */
function SkipReposCard({
  inputs,
  onChange,
  repos,
  error,
}: {
  inputs: ProfileInputs;
  onChange: (next: ProfileInputs) => void;
  repos: RepoOption[] | null;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => new Set(inputs.skipRepos),
    [inputs.skipRepos],
  );

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.trim().toLowerCase();
    const ranked = [...repos].sort((a, b) => {
      // Pinned-feel: starred > regular > archived/forks at the bottom.
      const aDeprioritized = (a.archived ? 1 : 0) + (a.fork ? 1 : 0);
      const bDeprioritized = (b.archived ? 1 : 0) + (b.fork ? 1 : 0);
      if (aDeprioritized !== bDeprioritized)
        return aDeprioritized - bDeprioritized;
      // Then by recent push.
      const at = a.pushed_at ?? "";
      const bt = b.pushed_at ?? "";
      return bt.localeCompare(at);
    });
    if (!q) return ranked;
    return ranked.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false) ||
        (r.language?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, query]);

  const toggle = (fullName: string) => {
    const next = new Set(selected);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    onChange({ ...inputs, skipRepos: [...next] });
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5 sm:p-6 shadow-[var(--shadow-card)]">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-2">
        Repos to skip · optional
      </div>
      <h2 className="text-[15px] sm:text-[16px] font-medium leading-snug">
        Anything you'd rather we leave out?
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Pick experiments, coursework, or personal repos that shouldn't shape
        the public narrative. We'll skip them entirely — they won't be cloned,
        judged, or featured.
      </p>

      {error ? (
        <p className="mt-4 rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.05] p-3 text-[12px] leading-relaxed text-[var(--destructive)]">
          {error}
        </p>
      ) : !repos ? (
        <p className="mt-4 text-[12px] text-muted-foreground">
          Loading your repos…
        </p>
      ) : repos.length === 0 ? (
        <p className="mt-4 text-[12px] text-muted-foreground">
          No owned repos found — nothing to skip.
        </p>
      ) : (
        <>
          {selected.size > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {[...selected].map((fullName) => (
                <button
                  key={fullName}
                  type="button"
                  onClick={() => toggle(fullName)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/[0.06] px-2 py-1 text-[12px] font-mono text-foreground hover:bg-[var(--destructive)]/[0.12] transition-colors"
                  aria-label={`Remove ${fullName} from skip list`}
                >
                  {fullName}
                  <span className="text-muted-foreground">✕</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${repos.length} repos…`}
              className="w-full rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-11"
            />
          </div>

          <div className="mt-2 max-h-72 overflow-y-auto gs-pane-scroll rounded-xl border border-border/40 divide-y divide-border/30">
            {filtered.length === 0 ? (
              <p className="p-3 text-[12px] text-muted-foreground">
                No matches.
              </p>
            ) : (
              filtered.slice(0, 100).map((r) => {
                const isSel = selected.has(r.full_name);
                return (
                  <label
                    key={r.full_name}
                    className={[
                      "flex items-start gap-3 px-3 py-2 text-[12.5px] cursor-pointer transition-colors",
                      isSel
                        ? "bg-[var(--destructive)]/[0.06]"
                        : "hover:bg-accent/30",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(r.full_name)}
                      className="mt-0.5 size-4 cursor-pointer"
                    />
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-mono text-foreground/95 truncate">
                        {r.name}
                        {r.archived ? (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            archived
                          </span>
                        ) : null}
                        {r.fork ? (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            fork
                          </span>
                        ) : null}
                      </span>
                      {r.description ? (
                        <span className="text-[11.5px] text-muted-foreground line-clamp-2">
                          {r.description}
                        </span>
                      ) : null}
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground/80 font-mono">
                        {r.language ? <span>{r.language}</span> : null}
                        {r.stars > 0 ? <span>{r.stars}★</span> : null}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
            {filtered.length > 100 ? (
              <p className="p-2 text-center text-[10px] text-muted-foreground/70">
                +{filtered.length - 100} more — refine your search
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
