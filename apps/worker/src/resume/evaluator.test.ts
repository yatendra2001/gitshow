/**
 * Deterministic checks for the quality-gate evaluator. No network,
 * no LLM — pure logic.
 *
 * Run: bun test apps/worker/src/resume/evaluator.test.ts
 */
import { describe, test, expect } from "bun:test";
import { evaluateResume, formatReportForAgent } from "./evaluator.js";
import type { Resume } from "@gitshow/shared/resume";

function baseResume(overrides: Partial<Resume> = {}): Resume {
  return {
    schemaVersion: 1,
    person: {
      name: "Test User",
      handle: "testuser",
      initials: "TU",
      avatarUrl: "",
      location: "",
      description: "desc",
      summary: "summary with [see projects](/#projects) and [work](/#work).",
    },
    contact: { social: {} },
    skills: Array.from({ length: 10 }, (_, i) => ({ name: `s${i}` })),
    work: [],
    education: [],
    projects: Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`,
      title: `p${i}`,
      dates: "",
      description: "x".repeat(80),
      active: false,
      technologies: [],
      links: [],
      href: "https://example.com",
    })),
    buildLog: Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      title: `b${i}`,
      description: "desc",
      language: null,
      languageColor: null,
      dates: "",
      href: "",
    })),
    blog: [],
    theme: { initials: "TU" },
    sections: { projectsOrder: [], buildLogOrder: [] },
    meta: {
      scanId: "s",
      generatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
      pipeline: "resume",
      sourceUrl: "",
    },
    ...overrides,
  } as Resume;
}

describe("evaluator", () => {
  test("flags empty work when LinkedIn was provided", () => {
    const r = evaluateResume({
      resume: baseResume({ work: [] }),
      hasLinkedIn: true,
      hasIntakeSignal: false,
    });
    expect(r.pass).toBe(false);
    expect(r.issues.some((i) => i.section === "work" && i.severity === "error")).toBe(true);
    expect(r.sectionsToRerun).toContain("work");
  });

  test("does NOT flag empty work when there's no LinkedIn and no intake", () => {
    const r = evaluateResume({
      resume: baseResume({ work: [] }),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    expect(r.issues.some((i) => i.section === "work" && i.severity === "error")).toBe(false);
  });

  test("flags too-few skills", () => {
    const r = evaluateResume({
      resume: baseResume({ skills: [{ name: "a" }, { name: "b" }] }),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    expect(r.pass).toBe(false);
    const skillsErr = r.issues.find((i) => i.section === "skills");
    expect(skillsErr?.severity).toBe("error");
  });

  test("flags zero projects, not 6 projects", () => {
    const r = evaluateResume({
      resume: baseResume({ projects: [] }),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    expect(r.issues.some((i) => i.section === "projects" && i.severity === "error")).toBe(true);

    const r2 = evaluateResume({
      resume: baseResume({ projects: Array.from({ length: 6 }, (_, i) => ({
        id: `p${i}`, title: `p${i}`, dates: "", description: "x".repeat(80),
        active: false, technologies: [], links: [], href: "https://example.com",
      })) }),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    expect(r2.issues.some((i) => i.section === "projects" && i.severity === "error")).toBe(false);
  });

  test("warns on missing cross-section links in summary", () => {
    const r = evaluateResume({
      resume: baseResume({
        person: {
          ...baseResume().person,
          summary: "A short summary with no linked sections at all.",
        },
      }),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    expect(r.issues.some((i) => i.section === "person")).toBe(true);
  });

  test("formatReportForAgent produces useful feedback text", () => {
    const r = evaluateResume({
      resume: baseResume({ skills: [] }),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    const text = formatReportForAgent(r);
    expect(text).toContain("skills");
    expect(text).toContain("previous attempt");
  });

  test("clean resume passes with zero issues", () => {
    const r = evaluateResume({
      resume: baseResume(),
      hasLinkedIn: false,
      hasIntakeSignal: false,
    });
    expect(r.pass).toBe(true);
    expect(r.issues).toEqual([]);
  });
});
