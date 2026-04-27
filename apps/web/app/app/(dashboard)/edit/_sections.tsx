"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Resume,
  WorkEntry,
  EducationEntry,
  Skill,
  Project,
  ProjectWebMention,
  BuildLogEntry,
  BlogPost,
  IconKey,
  Link as ResumeLink,
  SocialLink,
  SectionKey,
  TemplateId,
} from "@gitshow/shared/resume";
import { DEFAULT_SECTION_ORDER } from "@gitshow/shared/resume";
import { TEMPLATES } from "@/components/templates/registry";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  CheckboxField,
  InputField,
  ListEditor,
  MediaUploadField,
  SelectField,
  TextareaField,
} from "./_form";
import { SkillIconPicker } from "@/components/skill-icon-picker";
import { cn } from "@/lib/utils";

/**
 * Per-section form components. Each takes the current draft + an
 * `onPatch` callback that applies a partial mutation. The callback is
 * debounced and batched upstream in the Editor shell, so these forms
 * can call it on every change without worrying about write amplification.
 */

export function HeroSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const p = resume.person;
  const setPerson = (next: Partial<typeof p>) =>
    onPatch({ person: { ...p, ...next } });

  return (
    <div className="flex flex-col gap-5">
      <MediaUploadField
        label="Avatar"
        value={p.avatarUrl}
        onChange={(url) => setPerson({ avatarUrl: url })}
        accept="image/png,image/jpeg,image/webp,image/gif"
        hint="Square images look best. Falls back to initials when empty."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InputField
          label="Name"
          value={p.name}
          onChange={(v) => setPerson({ name: v })}
          placeholder="Full name"
          required
        />
        <InputField
          label="Initials"
          value={p.initials}
          onChange={(v) => setPerson({ initials: v.toUpperCase().slice(0, 4) })}
          placeholder="YK"
          hint="2 chars preferred. Used as avatar fallback."
        />
      </div>
      <TextareaField
        label="One-line bio (hero subtitle)"
        value={p.description}
        onChange={(v) => setPerson({ description: v })}
        placeholder="Software engineer turned entrepreneur. Love building things."
        hint="12-30 words. Sits directly under your name."
        rows={3}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InputField
          label="Location"
          value={p.location ?? ""}
          onChange={(v) => setPerson({ location: v || undefined })}
          placeholder="Pune, India"
        />
        <InputField
          label="Canonical URL"
          value={p.url ?? ""}
          onChange={(v) => setPerson({ url: v || undefined })}
          placeholder="https://gitshow.io/yatendra2001"
          type="url"
          hint="Defaults to gitshow.io/{your-handle}."
        />
      </div>
    </div>
  );
}

export function AboutSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const p = resume.person;
  return (
    <div className="flex flex-col gap-4">
      <TextareaField
        label="Summary (markdown)"
        value={p.summary}
        onChange={(v) => onPatch({ person: { ...p, summary: v } })}
        rows={12}
        hint="3-6 sentences. Embed cross-section links like [at buildspace](/#education) — they'll scroll to that section."
      />
    </div>
  );
}

export function WorkSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const update = (next: WorkEntry[]) => onPatch({ work: next });
  return (
    <ListEditor<WorkEntry>
      label="Work experience"
      items={resume.work}
      onChange={update}
      addLabel="Add role"
      emptyLabel="No work entries yet."
      factory={() => ({
        id: `work-${nanoid(8)}`,
        company: "",
        title: "",
        start: "",
        end: "",
        location: undefined,
        logoUrl: undefined,
        description: "",
        href: undefined,
        badges: [],
      })}
      renderItem={(item, _i, onItemChange) => (
        <div className="flex flex-col gap-3">
          <MediaUploadField
            label="Company logo"
            value={item.logoUrl}
            onChange={(url) => onItemChange({ ...item, logoUrl: url })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField
              label="Company"
              value={item.company}
              onChange={(v) => onItemChange({ ...item, company: v })}
              required
            />
            <InputField
              label="Title"
              value={item.title}
              onChange={(v) => onItemChange({ ...item, title: v })}
              required
            />
            <InputField
              label="Start"
              value={item.start}
              onChange={(v) => onItemChange({ ...item, start: v })}
              placeholder="May 2021"
              required
            />
            <InputField
              label="End"
              value={item.end}
              onChange={(v) => onItemChange({ ...item, end: v })}
              placeholder="Present"
            />
            <InputField
              label="Location"
              value={item.location ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, location: v || undefined })
              }
            />
            <InputField
              label="Company URL"
              value={item.href ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, href: v || undefined })
              }
              type="url"
            />
          </div>
          <TextareaField
            label="Description (markdown)"
            value={item.description}
            onChange={(v) => onItemChange({ ...item, description: v })}
            rows={4}
            hint="1-3 sentences. Specific. What did you ship, own, improve?"
          />
        </div>
      )}
    />
  );
}

export function EducationSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  return (
    <ListEditor<EducationEntry>
      label="Education"
      items={resume.education}
      onChange={(next) => onPatch({ education: next })}
      addLabel="Add school"
      emptyLabel="No education entries yet."
      factory={() => ({
        id: `edu-${nanoid(8)}`,
        school: "",
        degree: "",
        start: "",
        end: "",
        logoUrl: undefined,
        href: undefined,
      })}
      renderItem={(item, _i, onItemChange) => (
        <div className="flex flex-col gap-3">
          <MediaUploadField
            label="School logo"
            value={item.logoUrl}
            onChange={(url) => onItemChange({ ...item, logoUrl: url })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField
              label="School"
              value={item.school}
              onChange={(v) => onItemChange({ ...item, school: v })}
              required
            />
            <InputField
              label="Degree / program"
              value={item.degree}
              onChange={(v) => onItemChange({ ...item, degree: v })}
            />
            <InputField
              label="Start"
              value={item.start}
              onChange={(v) => onItemChange({ ...item, start: v })}
              placeholder="2019"
            />
            <InputField
              label="End"
              value={item.end}
              onChange={(v) => onItemChange({ ...item, end: v })}
              placeholder="2023"
            />
            <InputField
              label="School URL"
              value={item.href ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, href: v || undefined })
              }
              type="url"
            />
          </div>
        </div>
      )}
    />
  );
}

export function SkillsSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  return (
    <ListEditor<Skill>
      label="Skills"
      items={resume.skills}
      onChange={(next) => onPatch({ skills: next })}
      addLabel="Add skill"
      emptyLabel="No skills yet."
      max={40}
      factory={() => ({ name: "", iconKey: undefined })}
      renderItem={(item, _i, onItemChange) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InputField
            label="Name"
            value={item.name}
            onChange={(v) => onItemChange({ ...item, name: v })}
            placeholder="TypeScript"
            required
          />
          <SkillIconPicker
            label="Icon"
            value={item.iconKey}
            onChange={(next) => onItemChange({ ...item, iconKey: next })}
            hint="Search the catalogue, or pick text-only to render without a brand mark."
          />
        </div>
      )}
    />
  );
}

const LINK_ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "generic", label: "Generic / globe" },
  { value: "github", label: "GitHub" },
  { value: "globe", label: "Website" },
  { value: "youtube", label: "YouTube" },
  { value: "medium", label: "Medium" },
  { value: "devto", label: "dev.to" },
  { value: "hashnode", label: "Hashnode" },
  { value: "substack", label: "Substack" },
  { value: "producthunt", label: "Product Hunt" },
  { value: "x", label: "X / Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "discord", label: "Discord" },
];

function LinkListEditor({
  label,
  items,
  onChange,
  maxLabel,
}: {
  label: string;
  items: ResumeLink[];
  onChange: (next: ResumeLink[]) => void;
  maxLabel?: string;
}) {
  return (
    <ListEditor<ResumeLink>
      label={label}
      items={items}
      onChange={onChange}
      addLabel="Add link"
      emptyLabel="No links."
      max={maxLabel ? undefined : 10}
      factory={() => ({ label: "", href: "", iconKey: "generic" })}
      renderItem={(item, _i, onItemChange) => (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InputField
            label="Label"
            value={item.label}
            onChange={(v) => onItemChange({ ...item, label: v })}
            placeholder="Website"
            required
          />
          <InputField
            label="URL"
            value={item.href}
            onChange={(v) => onItemChange({ ...item, href: v })}
            type="url"
            required
          />
          <SelectField
            label="Icon"
            value={(item.iconKey ?? "generic") as string}
            onChange={(v) => onItemChange({ ...item, iconKey: v as IconKey })}
            options={LINK_ICON_OPTIONS}
          />
        </div>
      )}
    />
  );
}

export function ProjectsSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  return (
    <ListEditor<Project>
      label="Featured projects"
      items={resume.projects}
      onChange={(next) => onPatch({ projects: next })}
      addLabel="Add project"
      emptyLabel="No projects yet."
      max={40}
      factory={() => ({
        id: `proj-${nanoid(8)}`,
        title: "",
        description: "",
        dates: "",
        active: true,
        technologies: [],
        links: [],
        image: undefined,
        video: undefined,
        href: undefined,
        kind: "code",
      })}
      renderItem={(item, _i, onItemChange) => (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MediaUploadField
              label="Cover image"
              value={item.image}
              onChange={(url) => onItemChange({ ...item, image: url })}
              accept="image/png,image/jpeg,image/webp,image/gif"
            />
            <MediaUploadField
              label="Video / mp4 loop"
              value={item.video}
              onChange={(url) => onItemChange({ ...item, video: url })}
              accept="video/mp4,video/webm"
              hint="Video wins over image when both are set."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField
              label="Title"
              value={item.title}
              onChange={(v) => onItemChange({ ...item, title: v })}
              required
            />
            <InputField
              label="Dates"
              value={item.dates}
              onChange={(v) => onItemChange({ ...item, dates: v })}
              placeholder="Jan 2024 - Present"
            />
            <InputField
              label="Canonical URL"
              value={item.href ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, href: v || undefined })
              }
              type="url"
            />
            <CheckboxField
              label="Active project"
              value={item.active}
              onChange={(v) => onItemChange({ ...item, active: v })}
            />
          </div>
          <TextareaField
            label="Description (markdown)"
            value={item.description}
            onChange={(v) => onItemChange({ ...item, description: v })}
            rows={4}
          />
          <TextareaField
            label="Technologies (comma-separated)"
            value={item.technologies.join(", ")}
            onChange={(v) =>
              onItemChange({
                ...item,
                technologies: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            rows={2}
            placeholder="Next.js, TypeScript, Postgres, Stripe"
          />
          <LinkListEditor
            label="Links"
            items={item.links}
            onChange={(next) => onItemChange({ ...item, links: next })}
          />
          <WebMentionsEditor
            value={item.webMentions ?? []}
            onChange={(next) =>
              onItemChange({
                ...item,
                webMentions: next.length > 0 ? next : undefined,
              })
            }
          />
        </div>
      )}
    />
  );
}

/**
 * Editor for the "Featured at" row on a project card. Each row carries
 * the WebMention shape (source label + title + URL). The pipeline
 * pre-fills these from the Gemini grounded evidence pass; this lets
 * the owner curate or add their own (HN posts, press, podcasts) that
 * the search didn't surface.
 */
function WebMentionsEditor({
  value,
  onChange,
}: {
  value: ProjectWebMention[];
  onChange: (next: ProjectWebMention[]) => void;
}) {
  return (
    <ListEditor<ProjectWebMention>
      label="Featured at"
      items={value}
      onChange={onChange}
      addLabel="Add mention"
      emptyLabel="No mentions yet."
      max={5}
      factory={() => ({ title: "", url: "", source: "" })}
      renderItem={(item, _i, onItemChange) => (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InputField
            label="Source"
            value={item.source}
            onChange={(v) => onItemChange({ ...item, source: v })}
            placeholder="Hacker News"
            required
          />
          <InputField
            label="Title"
            value={item.title}
            onChange={(v) => onItemChange({ ...item, title: v })}
            placeholder="Show HN: …"
            required
          />
          <InputField
            label="URL"
            value={item.url}
            onChange={(v) => onItemChange({ ...item, url: v })}
            type="url"
            required
          />
        </div>
      )}
    />
  );
}

export function BuildLogSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  return (
    <ListEditor<BuildLogEntry>
      label={`"I like building things" timeline`}
      items={resume.buildLog}
      onChange={(next) => onPatch({ buildLog: next })}
      addLabel="Add entry"
      emptyLabel="No build-log entries yet."
      max={500}
      factory={() => ({
        id: `bl-${nanoid(8)}`,
        title: "",
        dates: "",
        description: "",
        primaryLanguage: undefined,
        languageColor: undefined,
        location: undefined,
        win: undefined,
        image: undefined,
        links: [],
      })}
      renderItem={(item, _i, onItemChange) => (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField
              label="Title"
              value={item.title}
              onChange={(v) => onItemChange({ ...item, title: v })}
              required
            />
            <InputField
              label="Dates"
              value={item.dates}
              onChange={(v) => onItemChange({ ...item, dates: v })}
              placeholder="2024 - Present"
            />
            <InputField
              label="Primary language"
              value={item.primaryLanguage ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, primaryLanguage: v || undefined })
              }
              placeholder="TypeScript"
            />
            <InputField
              label="Language color (hex)"
              value={item.languageColor ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, languageColor: v || undefined })
              }
              placeholder="#3178c6"
              hint="Timeline dot color. Leave empty for neutral."
            />
            <InputField
              label="Win / award"
              value={item.win ?? ""}
              onChange={(v) => onItemChange({ ...item, win: v || undefined })}
              placeholder="1st place"
            />
            <InputField
              label="Location"
              value={item.location ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, location: v || undefined })
              }
            />
          </div>
          <TextareaField
            label="One-line description"
            value={item.description}
            onChange={(v) => onItemChange({ ...item, description: v })}
            rows={2}
          />
          <LinkListEditor
            label="Links"
            items={item.links}
            onChange={(next) => onItemChange({ ...item, links: next })}
          />
        </div>
      )}
    />
  );
}

function SocialField({
  label,
  value,
  onChange,
  iconKey,
  placeholder,
}: {
  label: string;
  value: SocialLink | undefined;
  onChange: (v: SocialLink | undefined) => void;
  iconKey: string;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={value?.url ?? ""}
          onChange={(e) => {
            const url = e.target.value.trim();
            if (!url) {
              onChange(undefined);
              return;
            }
            onChange({
              name: label,
              url,
              iconKey: iconKey as IconKey,
              navbar: value?.navbar ?? true,
            });
          }}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] placeholder:text-muted-foreground/35 focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-10"
        />
        {value ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={value.navbar}
              onChange={(e) =>
                onChange({ ...value, navbar: e.target.checked })
              }
              className="size-3.5 accent-foreground"
            />
            Dock
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function ContactSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const c = resume.contact;
  const setSocials = (next: Partial<typeof c.socials>) =>
    onPatch({ contact: { ...c, socials: { ...c.socials, ...next } } });

  return (
    <div className="flex flex-col gap-4">
      <InputField
        label="Email"
        value={c.email ?? ""}
        onChange={(v) => onPatch({ contact: { ...c, email: v || undefined } })}
        type="email"
        placeholder="you@example.com"
      />

      <div className="rounded-xl border border-border/40 bg-card/30 p-4 flex flex-col gap-3">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
          Socials
        </span>
        <SocialField
          label="GitHub"
          iconKey="github"
          value={c.socials.github}
          onChange={(v) => setSocials({ github: v })}
          placeholder="https://github.com/your-handle"
        />
        <SocialField
          label="LinkedIn"
          iconKey="linkedin"
          value={c.socials.linkedin}
          onChange={(v) => setSocials({ linkedin: v })}
          placeholder="https://www.linkedin.com/in/you"
        />
        <SocialField
          label="X / Twitter"
          iconKey="x"
          value={c.socials.x}
          onChange={(v) => setSocials({ x: v })}
          placeholder="https://x.com/your-handle"
        />
        <SocialField
          label="YouTube"
          iconKey="youtube"
          value={c.socials.youtube}
          onChange={(v) => setSocials({ youtube: v })}
          placeholder="https://youtube.com/@your-handle"
        />
        <SocialField
          label="Website"
          iconKey="globe"
          value={c.socials.website}
          onChange={(v) => setSocials({ website: v })}
          placeholder="https://you.dev"
        />
      </div>

      <ListEditor<SocialLink>
        label="Additional socials"
        items={c.socials.other}
        onChange={(next) =>
          onPatch({ contact: { ...c, socials: { ...c.socials, other: next } } })
        }
        addLabel="Add social link"
        emptyLabel="No extra social links."
        factory={() => ({
          name: "",
          url: "",
          iconKey: "generic",
          navbar: true,
        })}
        renderItem={(item, _i, onItemChange) => (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <InputField
              label="Name"
              value={item.name}
              onChange={(v) => onItemChange({ ...item, name: v })}
              placeholder="Product Hunt"
            />
            <InputField
              label="URL"
              value={item.url}
              onChange={(v) => onItemChange({ ...item, url: v })}
              type="url"
            />
            <SelectField
              label="Icon"
              value={item.iconKey as string}
              onChange={(v) => onItemChange({ ...item, iconKey: v as IconKey })}
              options={LINK_ICON_OPTIONS}
            />
            <CheckboxField
              label="Show in dock"
              value={item.navbar}
              onChange={(v) => onItemChange({ ...item, navbar: v })}
            />
          </div>
        )}
      />
    </div>
  );
}

export function BlogSectionForm({
  resume,
  onPatch,
  handle,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
  handle: string;
}) {
  return (
    <ListEditor<BlogPost>
      label="Blog posts"
      items={resume.blog}
      onChange={(next) => onPatch({ blog: next })}
      addLabel="Add post"
      emptyLabel="No blog posts imported yet. Add URLs at intake to import verbatim."
      max={50}
      factory={() => ({
        slug: `post-${nanoid(6)}`,
        title: "",
        summary: "",
        publishedAt: new Date().toISOString().slice(0, 10),
        sourceUrl: undefined,
        sourcePlatform: undefined,
        image: undefined,
        body: "",
      })}
      renderItem={(item, _i, onItemChange) => (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField
              label="Slug"
              value={item.slug}
              onChange={(v) =>
                onItemChange({
                  ...item,
                  slug: v
                    .toLowerCase()
                    .replace(/[^a-z0-9-]+/g, "-")
                    .replace(/^-+|-+$/g, ""),
                })
              }
              hint={`Public URL: /${handle}/blog/{slug}`}
              required
            />
            <InputField
              label="Published (YYYY-MM-DD)"
              value={item.publishedAt}
              onChange={(v) => onItemChange({ ...item, publishedAt: v })}
            />
          </div>
          <InputField
            label="Title"
            value={item.title}
            onChange={(v) => onItemChange({ ...item, title: v })}
            required
          />
          <TextareaField
            label="Summary"
            value={item.summary}
            onChange={(v) => onItemChange({ ...item, summary: v })}
            rows={2}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField
              label="Original URL"
              value={item.sourceUrl ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, sourceUrl: v || undefined })
              }
              type="url"
            />
            <InputField
              label="Platform (e.g. Medium)"
              value={item.sourcePlatform ?? ""}
              onChange={(v) =>
                onItemChange({ ...item, sourcePlatform: v || undefined })
              }
            />
          </div>
          <MediaUploadField
            label="Cover image"
            value={item.image}
            onChange={(url) => onItemChange({ ...item, image: url })}
          />
          <MarkdownField
            label="Body (markdown)"
            value={item.body}
            onChange={(v) => onItemChange({ ...item, body: v })}
          />
        </div>
      )}
    />
  );
}

/**
 * Split-pane markdown editor with live preview. Desktop shows edit +
 * preview side-by-side; mobile falls back to a tab toggle so we don't
 * halve the already-cramped mobile viewport.
 */
function MarkdownField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-foreground font-medium">{label}</span>
        <div className="md:hidden inline-flex rounded-lg border border-border/40 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "px-2 py-1 rounded-md transition-colors",
              mode === "edit"
                ? "bg-foreground text-background"
                : "text-muted-foreground",
            )}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "px-2 py-1 rounded-md transition-colors",
              mode === "preview"
                ? "bg-foreground text-background"
                : "text-muted-foreground",
            )}
          >
            Preview
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={20}
          placeholder={"# Hello world\n\nWrite your post in markdown…"}
          className={cn(
            "rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] leading-relaxed font-mono focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-[400px]",
            mode === "preview" && "hidden md:block",
          )}
        />
        <div
          className={cn(
            "rounded-xl border border-border/40 bg-card/40 px-4 py-3 overflow-auto min-h-[400px]",
            mode === "edit" && "hidden md:block",
          )}
        >
          <div className="prose max-w-full text-pretty font-sans leading-relaxed text-muted-foreground dark:prose-invert text-[13px]">
            {value.trim().length > 0 ? (
              <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
            ) : (
              <span className="text-muted-foreground/50 italic">
                Preview appears here.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const t = resume.theme;
  return (
    <div className="flex flex-col gap-5">
      <SelectField
        label="Default mode"
        value={t.mode}
        onChange={(v) => onPatch({ theme: { ...t, mode: v } })}
        options={[
          { value: "dark", label: "Dark (default)" },
          { value: "light", label: "Light" },
          { value: "system", label: "Match system" },
        ]}
        hint="Visitors can still toggle via the dock; this is the first-visit default."
      />
      <div className="flex flex-col gap-1">
        <span className="text-[12px] text-foreground font-medium">
          Accent color (hex)
        </span>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={t.accentHex ?? "#3178c6"}
            onChange={(e) =>
              onPatch({ theme: { ...t, accentHex: e.target.value } })
            }
            className="h-10 w-16 cursor-pointer rounded-lg border border-border/50 bg-card/30"
          />
          <input
            type="text"
            value={t.accentHex ?? ""}
            onChange={(e) =>
              onPatch({
                theme: { ...t, accentHex: e.target.value || undefined },
              })
            }
            placeholder="#3178c6"
            className="flex-1 rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-[13px] focus:outline-none focus:shadow-[var(--shadow-composer-focus)] transition-shadow duration-200 min-h-10"
          />
          {t.accentHex ? (
            <button
              type="button"
              onClick={() =>
                onPatch({ theme: { ...t, accentHex: undefined } })
              }
              className="rounded-xl border border-border/40 px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              Clear
            </button>
          ) : null}
        </div>
        <span className="text-[11px] text-muted-foreground">
          Rendered as links + accents on the live portfolio. Leave empty for
          the neutral grayscale default.
        </span>
      </div>
    </div>
  );
}

export function LayoutSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const order = resume.sections.order;
  const hidden = new Set(resume.sections.hidden);

  const toggleHidden = (key: SectionKey) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onPatch({
      sections: {
        ...resume.sections,
        hidden: Array.from(next) as typeof resume.sections.hidden,
      },
    });
  };

  const move = (key: SectionKey, dir: -1 | 1) => {
    const i = order.indexOf(key);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[i], next[target]] = [next[target], next[i]];
    onPatch({
      sections: {
        ...resume.sections,
        order: next as typeof resume.sections.order,
      },
    });
  };

  const reset = () =>
    onPatch({
      sections: {
        order: DEFAULT_SECTION_ORDER as typeof resume.sections.order,
        hidden: [] as typeof resume.sections.hidden,
      },
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-muted-foreground">
        Reorder or hide whole sections of your portfolio. Hidden sections
        stay in the draft but don&apos;t render on the live page.
      </p>
      <div className="flex flex-col gap-2">
        {order.map((key, i) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/40 px-4 py-2"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-muted-foreground w-6">
                {i + 1}.
              </span>
              <span className="text-[13px] font-medium capitalize">
                {SECTION_LABELS[key] ?? key}
              </span>
              {hidden.has(key) ? (
                <span className="text-[10px] uppercase tracking-wide rounded bg-[var(--destructive)]/10 text-[var(--destructive)] px-1.5 py-0.5">
                  hidden
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(key, -1)}
                disabled={i === 0}
                className="h-7 w-7 rounded border border-border/40 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(key, +1)}
                disabled={i === order.length - 1}
                className="h-7 w-7 rounded border border-border/40 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(key)}
                className="ml-1 rounded border border-border/40 px-2 h-7 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {hidden.has(key) ? "Show" : "Hide"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={reset}
        className="self-start text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        Reset to default order
      </button>
    </div>
  );
}

const SECTION_LABELS: Record<SectionKey, string> = {
  hero: "Hero",
  about: "About",
  work: "Work Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  hackathons: "Hackathons",
  publications: "Publications",
  buildLog: "Build Log",
  contact: "Contact",
};

/**
 * Template picker — gallery of every available template variant. The
 * editor calls onPatch with `theme.template` on click; the live preview
 * (in /app/preview) re-renders the new variant. Republishing the
 * portfolio promotes the choice to the public page.
 *
 * The chooser shows a stylised swatch + the template's tagline and
 * "best for" copy. We resist the temptation to render real screenshots
 * here — those would quickly go stale; the swatches stay coherent.
 */
export function TemplateSectionForm({
  resume,
  onPatch,
}: {
  resume: Resume;
  onPatch: (patch: Partial<Resume>) => void;
}) {
  const current = resume.theme.template;

  const onPick = (id: TemplateId) => {
    if (id === current) return;
    onPatch({ theme: { ...resume.theme, template: id } });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-foreground">
          Visual template
        </span>
        <span className="text-[11px] text-muted-foreground">
          The same Resume data, rendered with a different aesthetic. Pick one
          here, then{" "}
          <Link
            href="/app/preview"
            target="_blank"
            className="underline underline-offset-2 hover:text-foreground"
          >
            preview ↗
          </Link>{" "}
          and republish.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TEMPLATES.map((t) => {
          const active = t.id === current;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              aria-pressed={active}
              className={cn(
                "group relative flex flex-col items-stretch overflow-hidden rounded-xl border text-left transition-all",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-foreground/80 ring-2 ring-foreground/20"
                  : "border-border/50 hover:border-foreground/40 hover:shadow-sm",
              )}
            >
              <TemplateSwatchLarge id={t.id} />
              <div className="p-3 bg-card/40 border-t border-border/40">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-semibold text-[13.5px] leading-tight">
                    {t.name}
                  </div>
                  {active && (
                    <span className="size-5 rounded-full bg-foreground text-background flex items-center justify-center">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="text-[11.5px] text-muted-foreground leading-snug min-h-[2.6em]">
                  {t.tagline}
                </div>
                <div className="mt-2 pt-2 border-t border-border/30 text-[11px] text-muted-foreground/80 leading-snug min-h-[2.5em]">
                  <span className="text-foreground/80 font-medium">Best for: </span>
                  {t.bestFor}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.vibes.map((v) => (
                    <span
                      key={v}
                      className="text-[10px] uppercase tracking-wide text-muted-foreground/80 border border-border/40 rounded-full px-1.5 py-0.5"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: open{" "}
        <Link
          href="/app/preview"
          target="_blank"
          className="underline underline-offset-2 hover:text-foreground"
        >
          /app/preview
        </Link>{" "}
        in another tab — the floating Templates button (bottom-right) lets you
        try every variant against your real data without leaving the page.
      </p>
    </div>
  );
}

function TemplateSwatchLarge({ id }: { id: TemplateId }) {
  const meta = TEMPLATES.find((t) => t.id === id)!;
  const { bg, fg, accent } = meta.swatch;

  if (id === "classic") {
    return (
      <div className="aspect-[16/10] flex flex-col gap-2 p-4" style={{ background: bg }}>
        <div className="flex items-center gap-2">
          <div className="size-5 rounded-full" style={{ background: fg, opacity: 0.85 }} />
          <div className="h-2 w-24 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        </div>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: fg, opacity: 0.55 }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: fg, opacity: 0.35 }} />
        <div className="mt-auto flex gap-1.5">
          {[0.8, 0.45, 0.45, 0.45].map((o, i) => (
            <div key={i} className="h-3 w-6 rounded-md" style={{ background: i === 0 ? accent : fg, opacity: o }} />
          ))}
        </div>
      </div>
    );
  }

  if (id === "terminal") {
    return (
      <div className="aspect-[16/10] flex flex-col gap-1 p-3 font-mono" style={{ background: bg }}>
        <div className="flex gap-1">
          <div className="size-2 rounded-full bg-[#ff5f56]" />
          <div className="size-2 rounded-full bg-[#ffbd2e]" />
          <div className="size-2 rounded-full bg-[#27c93f]" />
        </div>
        <div className="text-[10px] mt-1" style={{ color: fg }}>$ whoami</div>
        <div className="text-[10px]" style={{ color: fg, opacity: 0.7 }}>{">"} engineer</div>
        <div className="text-[10px]" style={{ color: fg, opacity: 0.5 }}>──────────</div>
        <div className="text-[10px]" style={{ color: fg }}>$ cat about</div>
        <div className="text-[10px]" style={{ color: fg, opacity: 0.7 }}>{">"} I build _</div>
      </div>
    );
  }

  if (id === "spotlight") {
    return (
      <div className="aspect-[16/10] grid grid-cols-2 gap-2 p-3" style={{ background: bg }}>
        <div className="flex flex-col gap-1.5">
          <div className="size-3 rounded-full" style={{ background: accent, opacity: 0.7 }} />
          <div className="h-2 w-full rounded-full" style={{ background: fg, opacity: 0.85 }} />
          <div className="h-1 w-3/4 rounded-full" style={{ background: accent, opacity: 0.9 }} />
          <div className="mt-auto flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <div className="h-px w-6" style={{ background: accent }} />
              <div className="h-1 w-4 rounded-full" style={{ background: fg, opacity: 0.7 }} />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-px w-3" style={{ background: fg, opacity: 0.4 }} />
              <div className="h-1 w-4 rounded-full" style={{ background: fg, opacity: 0.4 }} />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-px w-3" style={{ background: fg, opacity: 0.4 }} />
              <div className="h-1 w-4 rounded-full" style={{ background: fg, opacity: 0.4 }} />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="h-1 w-full rounded-full" style={{ background: fg, opacity: 0.4 }} />
          <div className="h-1 w-3/4 rounded-full" style={{ background: fg, opacity: 0.3 }} />
          <div className="h-1 w-2/3 rounded-full" style={{ background: fg, opacity: 0.3 }} />
          <div className="h-1 w-3/4 rounded-full" style={{ background: fg, opacity: 0.3 }} />
          <div className="mt-2 h-8 rounded" style={{ background: `${fg}14` }} />
        </div>
      </div>
    );
  }

  if (id === "glow") {
    return (
      <div
        className="aspect-[16/10] flex flex-col gap-1.5 p-4 relative"
        style={{
          background: bg,
          backgroundImage: `radial-gradient(ellipse at top, ${accent}33, transparent 60%)`,
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className="size-2 rounded-full" style={{ background: accent }} />
          <div className="h-1 w-12 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        </div>
        <div
          className="h-3 w-2/3 rounded-full mt-1"
          style={{ background: `linear-gradient(135deg, ${fg}, ${accent})` }}
        />
        <div className="h-1 w-3/4 rounded-full" style={{ background: fg, opacity: 0.4 }} />
        <div className="mt-auto grid grid-cols-2 gap-1">
          <div className="h-7 rounded" style={{ background: `${fg}1a` }} />
          <div
            className="h-7 rounded"
            style={{ background: `linear-gradient(135deg, ${accent}40, ${fg}1a)` }}
          />
        </div>
      </div>
    );
  }

  if (id === "bento") {
    return (
      <div className="aspect-[16/10] grid grid-cols-4 grid-rows-3 gap-1 p-2" style={{ background: bg }}>
        <div className="col-span-2 row-span-2 rounded-md" style={{ background: `${accent}40` }} />
        <div className="rounded-md" style={{ background: `${fg}1a` }} />
        <div className="rounded-md" style={{ background: `${fg}14` }} />
        <div className="col-span-2 rounded-md" style={{ background: `${fg}1a` }} />
        <div className="rounded-md" style={{ background: `${accent}50` }} />
        <div className="rounded-md" style={{ background: `${fg}14` }} />
        <div className="col-span-3 rounded-md" style={{ background: `${fg}1a` }} />
        <div className="rounded-md" style={{ background: `${fg}14` }} />
      </div>
    );
  }

  // minimal
  return (
    <div className="aspect-[16/10] flex flex-col gap-1.5 p-4 font-mono" style={{ background: bg }}>
      <div className="flex justify-between items-baseline">
        <div className="h-1.5 w-16 rounded-full" style={{ background: accent, opacity: 0.95 }} />
        <div className="h-1 w-8 rounded-full" style={{ background: fg, opacity: 0.4 }} />
      </div>
      <div className="h-1 w-3/4 rounded-full" style={{ background: fg, opacity: 0.55 }} />
      <div className="h-1 w-1/2 rounded-full" style={{ background: fg, opacity: 0.4 }} />
      <div className="h-px w-full" style={{ background: fg, opacity: 0.2 }} />
      <div className="space-y-1 mt-auto">
        <div className="flex justify-between"><div className="h-1 w-1/3 rounded-full" style={{ background: fg, opacity: 0.55 }} /><div className="h-1 w-8 rounded-full" style={{ background: fg, opacity: 0.35 }} /></div>
        <div className="flex justify-between"><div className="h-1 w-1/2 rounded-full" style={{ background: fg, opacity: 0.55 }} /><div className="h-1 w-8 rounded-full" style={{ background: fg, opacity: 0.35 }} /></div>
        <div className="flex justify-between"><div className="h-1 w-2/5 rounded-full" style={{ background: fg, opacity: 0.55 }} /><div className="h-1 w-8 rounded-full" style={{ background: fg, opacity: 0.35 }} /></div>
      </div>
    </div>
  );
}
