/* eslint-disable @next/next/no-img-element */
"use client";

import BlurFade from "@/components/magicui/blur-fade";
import BlurFadeText from "@/components/magicui/blur-fade-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useData, useResume } from "@/components/data-provider";
import Link from "next/link";
import Markdown from "react-markdown";
import ContactSection from "@/components/section/contact-section";
import BuildLogSection from "@/components/section/build-log-section";
import ProjectsSection from "@/components/section/projects-section";
import WorkSection from "@/components/section/work-section";
import { LogoOrInitials } from "@/components/logo-or-initials";
import { formatResumeDateRange } from "@/lib/format-date";
import HackathonsSection from "@/components/sections/hackathons";
import PublicationsSection from "@/components/sections/publications";
import { ArrowUpRight } from "lucide-react";
import { useEffect, type ComponentProps } from "react";

const BLUR_FADE_DELAY = 0.04;

/**
 * Hook: intercept clicks on `/#section` anchor links anywhere in the
 * document and replace them with smooth scroll. Fixes the "page
 * reloads when you click an About link" bug.
 *
 * Why a document-level listener instead of just the react-markdown
 * components override: the override only runs for links rendered
 * via react-markdown. Anything else (a manually-authored anchor in
 * a child component, a Next `<Link>` someone added later, etc.)
 * still triggers a full Next.js nav. The document-level listener
 * catches every click regardless of where the link came from.
 *
 * Cmd/Ctrl/Shift/middle-click and explicit target="_blank" links
 * still pass through to the browser's default behaviour.
 */
function useSmoothHashAnchorScroll(): void {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      const target = e.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link) return;
      if (link.target && link.target !== "" && link.target !== "_self") return;
      const href = link.getAttribute("href");
      if (!href || !/^\/?#[A-Za-z][\w-]*$/.test(href)) return;
      const id = href.slice(href.indexOf("#") + 1);
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Sync the URL without a Next.js navigation.
      window.history.replaceState(null, "", `/#${id}`);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
}

/**
 * react-markdown components override that turns hash-only links
 * (`/#work`, `/#projects`, …) into smooth-scroll handlers instead of
 * full anchor navigations. The hero-prose stage embeds these links
 * by design — without this override, clicking one triggers a Next.js
 * /#section navigation that flashes the page before scrolling.
 *
 * Off-site links (https://…) and same-page raw `#anchor` links pass
 * through unchanged.
 */
/**
 * Slim section heading used in About / Work / Education / Skills.
 * The leading accent bar is a small originality touch — every other
 * "shadcn portfolio template" uses bare `h2`, so this is one of the
 * subtle differentiators. Stays light enough that it doesn't fight
 * the rest of the layout.
 */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-xl font-bold">
      <span
        aria-hidden
        className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-[var(--primary)] to-[var(--primary)]/40"
      />
      {children}
    </h2>
  );
}

const smoothAnchorMarkdownComponents = {
  a: ({ href, children, ...rest }: ComponentProps<"a">) => {
    const isHashRoute = typeof href === "string" && /^\/#[A-Za-z][\w-]*$/.test(href);
    if (!isHashRoute) {
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    }
    const id = href!.slice(2); // strip "/#"
    return (
      <a
        href={href}
        {...rest}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          const el = document.getElementById(id);
          if (!el) return;
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          // Sync the URL without triggering a Next nav.
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", href);
          }
        }}
      >
        {children}
      </a>
    );
  },
};

/**
 * Full template-shape portfolio render. Used by:
 *   - /{handle}/page.tsx — public profile
 *   - /app/preview — owner-only draft preview
 *
 * Must be wrapped in a <DataProvider> that supplies the Resume.
 */
export default function PortfolioPage() {
  const DATA = useData();
  const resume = useResume();
  const hidden = new Set(resume.sections.hidden);
  // Document-level click interceptor for /#section anchor links —
  // smooth-scrolls instead of full-page nav. See hook docstring.
  useSmoothHashAnchorScroll();
  return (
    <main className="min-h-dvh flex flex-col gap-14 relative">
      <section id="hero">
        <div className="mx-auto w-full max-w-2xl space-y-8">
          <div className="gap-2 gap-y-6 flex flex-col md:flex-row justify-between">
            <div className="gap-2 flex flex-col order-2 md:order-1">
              <BlurFadeText
                delay={BLUR_FADE_DELAY}
                className="text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl"
                yOffset={8}
                text={`Hi, I'm ${DATA.name.split(" ")[0]}`}
              />
              <BlurFadeText
                className="text-muted-foreground max-w-[600px] md:text-lg lg:text-xl"
                delay={BLUR_FADE_DELAY}
                text={DATA.description}
              />
            </div>
            <BlurFade delay={BLUR_FADE_DELAY} className="order-1 md:order-2">
              <Avatar className="size-24 md:size-32 border rounded-full shadow-lg ring-4 ring-muted">
                <AvatarImage alt={DATA.name} src={DATA.avatarUrl} />
                <AvatarFallback>{DATA.initials}</AvatarFallback>
              </Avatar>
            </BlurFade>
          </div>
        </div>
      </section>
      {!hidden.has("about") && (
        <section id="about">
          <div className="flex min-h-0 flex-col gap-y-4">
            <BlurFade delay={BLUR_FADE_DELAY * 3}>
              <SectionHeader>About</SectionHeader>
            </BlurFade>
            <BlurFade delay={BLUR_FADE_DELAY * 4}>
              <div className="prose max-w-full text-pretty font-sans leading-relaxed text-muted-foreground dark:prose-invert">
                <Markdown components={smoothAnchorMarkdownComponents}>
                  {DATA.summary}
                </Markdown>
              </div>
            </BlurFade>
          </div>
        </section>
      )}
      {!hidden.has("work") && DATA.work.length > 0 && (
        <section id="work">
          <div className="flex min-h-0 flex-col gap-y-6">
            <BlurFade delay={BLUR_FADE_DELAY * 5}>
              <SectionHeader>Work Experience</SectionHeader>
            </BlurFade>
            <BlurFade delay={BLUR_FADE_DELAY * 6}>
              <WorkSection />
            </BlurFade>
          </div>
        </section>
      )}
      {!hidden.has("education") && DATA.education.length > 0 && (
        <section id="education">
          <div className="flex min-h-0 flex-col gap-y-6">
            <BlurFade delay={BLUR_FADE_DELAY * 7}>
              <SectionHeader>Education</SectionHeader>
            </BlurFade>
          <div className="flex flex-col gap-8">
            {DATA.education.map((education, index) => (
              <BlurFade
                key={education.school}
                delay={BLUR_FADE_DELAY * 8 + index * 0.05}
              >
                <Link
                  href={education.href ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-x-3 justify-between group"
                >
                  <div className="flex items-center gap-x-3 flex-1 min-w-0">
                    <LogoOrInitials
                      src={education.logoUrl}
                      name={education.school}
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div className="font-semibold leading-none flex items-center gap-2">
                        {education.school}
                        <ArrowUpRight
                          className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
                          aria-hidden
                        />
                      </div>
                      <div className="font-sans text-sm text-muted-foreground">
                        {education.degree}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground text-right flex-none">
                    <span>{formatResumeDateRange(education.start, education.end)}</span>
                  </div>
                </Link>
              </BlurFade>
            ))}
          </div>
          </div>
        </section>
      )}
      {!hidden.has("skills") && DATA.skills.length > 0 && (
        <section id="skills">
          <div className="flex min-h-0 flex-col gap-y-4">
            <BlurFade delay={BLUR_FADE_DELAY * 9}>
              <SectionHeader>Skills</SectionHeader>
            </BlurFade>
            <div className="flex flex-wrap gap-2">
              {DATA.skills.map((skill, id) => (
                <BlurFade
                  key={skill.name}
                  delay={BLUR_FADE_DELAY * 10 + id * 0.05}
                >
                  <div
                    className="border bg-background border-border ring-2 ring-border/20 rounded-xl h-8 w-fit px-4 flex items-center gap-2"
                    title={
                      skill.usageCount
                        ? `Used in ${skill.usageCount} repo${skill.usageCount === 1 ? "" : "s"}`
                        : undefined
                    }
                  >
                    {skill.icon && (
                      <skill.icon className="size-4 rounded overflow-hidden object-contain" />
                    )}
                    <span className="text-foreground text-sm font-medium">
                      {skill.name}
                    </span>
                  </div>
                </BlurFade>
              ))}
            </div>
          </div>
        </section>
      )}
      {!hidden.has("projects") && (
        <section id="projects">
          <BlurFade delay={BLUR_FADE_DELAY * 11}>
            <ProjectsSection />
          </BlurFade>
        </section>
      )}
      {!hidden.has("hackathons") && resume.hackathons.length > 0 && (
        <BlurFade delay={BLUR_FADE_DELAY * 12}>
          <HackathonsSection entries={resume.hackathons} />
        </BlurFade>
      )}
      {!hidden.has("publications") && resume.publications.length > 0 && (
        <BlurFade delay={BLUR_FADE_DELAY * 13}>
          <PublicationsSection entries={resume.publications} />
        </BlurFade>
      )}
      {!hidden.has("buildLog") && DATA.hackathons.length > 0 && (
        <section id="buildLog">
          <BlurFade delay={BLUR_FADE_DELAY * 14}>
            <BuildLogSection />
          </BlurFade>
        </section>
      )}
      {!hidden.has("contact") && (
        <section id="contact">
          <BlurFade delay={BLUR_FADE_DELAY * 16}>
            <ContactSection />
          </BlurFade>
        </section>
      )}
    </main>
  );
}
