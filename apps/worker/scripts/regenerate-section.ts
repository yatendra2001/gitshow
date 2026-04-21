#!/usr/bin/env bun
/**
 * Per-section regenerate entrypoint.
 *
 * Spawned by the webapp at `/api/resume/regenerate` — runs just one
 * resume-pipeline agent against the user's existing draft and merges
 * the result back into R2. Much lighter than a full scan: one LLM
 * call (or a batched fan-out for projects), no inventory for simple
 * sections.
 *
 * Env:
 *   SECTION — "hero" | "about" | "work" | "education" | "skills" |
 *             "projects" | "buildLog" | "blog"
 *   HANDLE — GitHub handle of the owner (from session)
 *   USER_ID — used for asset key prefix isolation (unused here today)
 *   MODEL — default claude-sonnet-4.6
 *   OPENROUTER_API_KEY, GH_TOKEN — as usual
 *   CF_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *
 * Writes the updated Resume back to resumes/{handle}/draft.json.
 */

import "dotenv/config";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

import { ResumeSchema, type Resume } from "@gitshow/shared/resume";
import type { ScanSession, ScanSocials } from "../src/schemas.js";

import { fetchGitHubData } from "../src/github-fetcher.js";
import { normalize } from "../src/normalize.js";
import { SessionUsage } from "../src/session.js";

import { runPersonAgent } from "../src/resume/agents/person.js";
import { runSkillsAgent } from "../src/resume/agents/skills.js";
import { runBuildLogAgent } from "../src/resume/agents/build-log.js";
import { runProjectsAgent } from "../src/resume/agents/projects.js";
import { runWorkAgent } from "../src/resume/agents/work.js";
import { runEducationAgent } from "../src/resume/agents/education.js";
import { runBlogImportAgent } from "../src/resume/agents/blog-import.js";
import { pickFeatured } from "../src/resume/pick-featured.js";
import { logger, requireEnv } from "../src/util.js";

const log = (t: string) => process.stderr.write(t);

const SECTIONS = new Set([
  "hero",
  "about",
  "work",
  "education",
  "skills",
  "projects",
  "buildLog",
  "blog",
]);

async function main() {
  const section = requireEnv("SECTION");
  const handle = requireEnv("HANDLE");
  const model = process.env.MODEL || "anthropic/claude-sonnet-4.6";

  if (!SECTIONS.has(section)) {
    throw new Error(`unsupported section: ${section}`);
  }

  const accountId = requireEnv("CF_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  // Load current draft.
  const draftKey = `resumes/${handle.toLowerCase()}/draft.json`;
  const draft = await loadDraft(s3, bucket, draftKey);
  if (!draft) {
    throw new Error(`no draft found at ${draftKey}`);
  }
  logger.info({ handle, section }, "regenerate: loaded draft");

  // Minimal session — the agents read session.model / session.socials /
  // session.context_notes / session.blog_urls. We reconstruct these
  // from the existing draft where possible so regen is self-contained.
  const socials: ScanSocials = {};
  if (draft.contact.socials.x?.url) socials.twitter = draft.contact.socials.x.url;
  if (draft.contact.socials.linkedin?.url)
    socials.linkedin = draft.contact.socials.linkedin.url;
  if (draft.contact.socials.website?.url)
    socials.website = draft.contact.socials.website.url;

  const session: ScanSession = {
    id: `regen-${nanoid(10)}`,
    handle,
    socials,
    blog_urls: draft.blog.map((b) => b.sourceUrl).filter((u): u is string => !!u),
    context_notes: undefined,
    started_at: new Date().toISOString(),
    dashboard_url: `https://openrouter.ai/sessions/regen-${handle}`,
    model,
    cost_cap_usd: Number.POSITIVE_INFINITY,
  };
  const usage = new SessionUsage();

  // GitHub data + normalized artifacts — reused by multiple agents.
  // Inventory is skipped (it's expensive and a per-section regen
  // should be fast). First-commit dates in buildLog will fall back to
  // GitHub createdAt.
  log(`[regen] github fetch\n`);
  const github = await fetchGitHubData(handle);
  log(`[regen] normalize\n`);
  const { artifacts } = normalize({ github, inventories: {} });

  let next: Resume;

  switch (section) {
    case "hero":
    case "about": {
      log(`[regen] person agent (for ${section})\n`);
      const person = await runPersonAgent({
        session,
        usage,
        github,
        discover: {
          distinctive_paragraph: github.profile.bio ?? "",
          investigation_angles: [],
          primary_shape: "builder",
        },
        artifacts,
        featuredProjects: draft.projects.slice(0, 6).map((p) => ({
          title: p.title,
          summary: p.description.slice(0, 160),
        })),
        workCompanies: draft.work.map((w) => w.company),
        educationSchools: draft.education.map((e) => e.school),
        onProgress: log,
      });
      next = {
        ...draft,
        person: {
          ...draft.person,
          name: person.name,
          description: person.description,
          summary: person.summary,
          initials: person.initials,
        },
      };
      break;
    }
    case "skills": {
      log(`[regen] skills agent\n`);
      const skills = await runSkillsAgent({
        session,
        usage,
        github,
        artifacts,
        onProgress: log,
      });
      next = {
        ...draft,
        skills: skills.skills.map((s) => ({
          name: s.name,
          iconKey: s.iconKey,
        })),
      };
      break;
    }
    case "projects": {
      log(`[regen] projects agent fan-out\n`);
      const featured = pickFeatured(github, artifacts);
      const projects = await runProjectsAgent({
        session,
        usage,
        github,
        artifacts,
        featuredFullNames: featured,
        profileDir: `/tmp/gitshow/regen-${handle}`,
        onProgress: log,
      });
      next = { ...draft, projects };
      break;
    }
    case "buildLog": {
      log(`[regen] build-log agent\n`);
      const buildLog = await runBuildLogAgent({
        session,
        usage,
        github,
        artifacts,
        onProgress: log,
      });
      next = { ...draft, buildLog };
      break;
    }
    case "work": {
      log(`[regen] work agent\n`);
      const work = await runWorkAgent({
        session,
        usage,
        github,
        artifacts,
        onProgress: log,
      });
      next = { ...draft, work };
      break;
    }
    case "education": {
      log(`[regen] education agent\n`);
      const education = await runEducationAgent({
        session,
        usage,
        github,
        artifacts,
        onProgress: log,
      });
      next = { ...draft, education };
      break;
    }
    case "blog": {
      log(`[regen] blog-import agent\n`);
      const urls = draft.blog
        .map((b) => b.sourceUrl)
        .filter((u): u is string => !!u);
      const blog = await runBlogImportAgent({
        session,
        usage,
        urls,
        onProgress: log,
      });
      next = { ...draft, blog };
      break;
    }
    default:
      throw new Error(`unhandled section: ${section}`);
  }

  // Bump meta + validate before writing.
  next = {
    ...next,
    meta: {
      ...next.meta,
      version: (next.meta.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    },
  };

  const validated = ResumeSchema.parse(next);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: draftKey,
      Body: JSON.stringify(validated, null, 2),
      ContentType: "application/json",
      CacheControl: "no-store",
    }),
  );

  logger.info(
    {
      handle,
      section,
      llm_calls: usage.llmCalls,
      cost_usd: usage.estimatedCostUsd,
    },
    "regenerate: done",
  );
  process.exit(0);
}

async function loadDraft(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<Resume | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!resp.Body) return null;
    const text = await resp.Body.transformToString();
    const parsed = ResumeSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  logger.error({ err }, "regenerate-section: unhandled");
  process.exit(1);
});
