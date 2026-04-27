/* eslint-disable @next/next/no-img-element */
"use client";

import Markdown from "react-markdown";
import { useResume, useHandle } from "@/components/data-provider";
import { allSocials } from "@gitshow/shared/resume";
import { ArrowUpRight } from "lucide-react";

/**
 * Minimal — one column, mono font, almost text-only.
 *
 * Inspired by rauno.me / paco.me — information at maximum density,
 * zero ornament. Tabular alignments, hover-only highlights, mono
 * typography throughout. For senior engineers and design-conscious
 * folks allergic to chrome.
 */
export default function MinimalTemplate() {
  const r = useResume();
  const handle = useHandle();
  const hidden = new Set(r.sections.hidden);
  const socials = allSocials(r);
  const accent = "#ededed";

  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-neutral-400 font-mono text-[13.5px] leading-[1.7] selection:bg-neutral-700 selection:text-white">
      <div className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
        {/* Hero */}
        <header className="mb-14">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h1 className="text-white text-[15px] font-medium">{r.person.name}</h1>
            <span className="text-neutral-600 text-[12px]">@{handle}</span>
          </div>
          <p className="max-w-md">{r.person.description}</p>
          {r.person.location && (
            <p className="mt-2 text-neutral-600 text-[12px]">{r.person.location}</p>
          )}
        </header>

        {/* About */}
        <Section label="About">
          <div className="prose prose-invert max-w-none [&_p]:mb-3 [&_p]:text-neutral-400 [&_a]:text-white [&_a]:no-underline hover:[&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-white [&_em]:text-neutral-300">
            <Markdown>{r.person.summary}</Markdown>
          </div>
        </Section>

        {/* Work — 2-col table */}
        {!hidden.has("work") && r.work.length > 0 && (
          <Section label="Work">
            <ul className="space-y-1">
              {r.work.map((w) => (
                <li key={w.id} className="grid grid-cols-[1fr_auto] gap-3 items-baseline group">
                  <a
                    href={w.href ?? "#"}
                    target={w.href ? "_blank" : undefined}
                    rel="noreferrer"
                    className="truncate"
                  >
                    <span className="text-white group-hover:underline underline-offset-2">{w.company}</span>
                    <span className="text-neutral-500"> — {w.title}</span>
                  </a>
                  <span className="text-neutral-600 text-[12px] tabular-nums flex-none">
                    {compactRange(w.start, w.end)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Education */}
        {!hidden.has("education") && r.education.length > 0 && (
          <Section label="Education">
            <ul className="space-y-1">
              {r.education.map((e) => (
                <li key={e.id} className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                  <span className="truncate">
                    <span className="text-white">{e.school}</span>
                    <span className="text-neutral-500"> — {e.degree}</span>
                  </span>
                  <span className="text-neutral-600 text-[12px] tabular-nums flex-none">
                    {compactRange(e.start, e.end)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Projects */}
        {!hidden.has("projects") && r.projects.length > 0 && (
          <Section label="Projects">
            <ul className="space-y-3">
              {r.projects.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <a
                    href={p.href ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="grid grid-cols-[1fr_auto] gap-3 items-baseline group"
                  >
                    <span className="truncate">
                      <span className="text-white group-hover:underline underline-offset-2 inline-flex items-center gap-1">
                        {p.title}
                        <ArrowUpRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </span>
                    <span className="text-neutral-600 text-[12px] tabular-nums flex-none">
                      {p.dates}
                    </span>
                  </a>
                  <p className="text-neutral-500 text-[13px] leading-snug mt-0.5">
                    {stripMd(p.description)}
                  </p>
                  {p.technologies.length > 0 && (
                    <div className="text-neutral-700 text-[11.5px] mt-0.5">
                      {p.technologies.join(", ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Skills — single line */}
        {r.skills.length > 0 && (
          <Section label="Skills">
            <p>
              {r.skills.map((s, i) => (
                <span key={s.name}>
                  <span className="text-neutral-300">{s.name}</span>
                  {i < r.skills.length - 1 && <span className="text-neutral-700">, </span>}
                </span>
              ))}
            </p>
          </Section>
        )}

        {/* Hackathons */}
        {!hidden.has("hackathons") && r.hackathons.length > 0 && (
          <Section label="Hackathons">
            <ul className="space-y-1">
              {r.hackathons.map((h) => (
                <li key={h.id} className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                  <span className="truncate">
                    <span className="text-white">{h.title}</span>
                    {h.rank && <span className="text-neutral-500"> — {h.rank}</span>}
                  </span>
                  {h.date && (
                    <span className="text-neutral-600 text-[12px] tabular-nums flex-none">{h.date}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Publications */}
        {!hidden.has("publications") && r.publications.length > 0 && (
          <Section label="Writing">
            <ul className="space-y-1">
              {r.publications.map((p) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="grid grid-cols-[1fr_auto] gap-3 items-baseline group">
                    <span className="truncate text-white group-hover:underline underline-offset-2">{p.title}</span>
                    {p.publishedAt && (
                      <span className="text-neutral-600 text-[12px] tabular-nums flex-none">{p.publishedAt}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Build log — keep it short */}
        {!hidden.has("buildLog") && r.buildLog.length > 0 && (
          <Section label="Recently">
            <ul className="space-y-1">
              {r.buildLog.slice(0, 8).map((b) => (
                <li key={b.id} className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                  <span className="truncate">
                    <span className="text-white">{b.title}</span>
                    <span className="text-neutral-500"> — {b.description}</span>
                  </span>
                  <span className="text-neutral-600 text-[12px] tabular-nums flex-none">{b.dates}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Contact */}
        <Section label="Contact" last>
          <ul className="space-y-1">
            {r.contact.email && (
              <li className="grid grid-cols-[auto_1fr] gap-3 items-baseline">
                <span className="text-neutral-600 w-24">email</span>
                <a href={`mailto:${r.contact.email}`} className="text-white hover:underline underline-offset-2 truncate">
                  {r.contact.email}
                </a>
              </li>
            )}
            {socials.map((s) => (
              <li key={s.url} className="grid grid-cols-[auto_1fr] gap-3 items-baseline">
                <span className="text-neutral-600 w-24">{s.name.toLowerCase()}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-white hover:underline underline-offset-2 truncate">
                  {prettyUrl(s.url)}
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <footer className="mt-14 text-[11.5px] text-neutral-700">
          {r.person.name}, {new Date().getFullYear()}. Last updated{" "}
          {formatShort(r.meta.updatedAt)}.
        </footer>
      </div>

      <style>{`
        :root { --minimal-accent: ${accent}; }
      `}</style>
    </div>
  );
}

function Section({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "" : "mb-10"}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 mb-3 flex items-baseline gap-3">
        <span>{label}</span>
        <span className="flex-1 border-t border-neutral-800/80" />
      </div>
      {children}
    </section>
  );
}

function compactRange(start: string, end: string): string {
  return `${shortYear(start)}–${shortYear(end)}`;
}

function shortYear(s: string): string {
  const m = s.match(/(\d{4})/);
  if (!m) return s;
  return `'${m[1]!.slice(2)}`;
}

function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
}

function prettyUrl(u: string): string {
  try {
    const url = new URL(u);
    return (url.hostname + url.pathname).replace(/^www\./, "").replace(/\/$/, "");
  } catch {
    return u;
  }
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return "";
  }
}
