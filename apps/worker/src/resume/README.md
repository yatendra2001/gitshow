# Resume pipeline — Phase 2

New pipeline that produces a `Resume` JSON (see
`packages/shared/src/resume.ts`) instead of the legacy claim-based
`Profile` / `ProfileCard` in `apps/worker/src/pipeline.ts`.

**Status: scaffold.** Core plumbing (discover signals, person, skills,
build-log agents + assembler + CLI) lands in this commit. Heavy
per-project deep-research agent and work/education/blog agents are
staged with explicit TODO stubs for the next commit — so the whole
pipeline runs end-to-end today but `projects`/`work`/`education` come
out minimal until those agents are implemented.

## Design

1. **Collection stage** — unchanged: reuse `github-fetcher.ts`,
   `repo-filter.ts`, `inventory-runner.ts`, `normalize.ts`. These
   produce the same GitHubData + artifacts table the claim pipeline
   uses.

2. **Discover stage** — reuse the existing `agents/discover.ts` but
   only for its `investigation_angles` + `primary_shape`. In the
   resume world we don't care about claim-writing; we use the angles
   to guide per-project research.

3. **Section agents** — each owns one slice of the `Resume`:

   | Agent | Scope | Parallelism | LLM |
   |---|---|---|---|
   | `person-agent` | `person.*` (name, description, summary with cross-section links) | 1 | Opus 4.7 |
   | `skills-agent` | top skills with iconKey resolution | 1 | Sonnet 4.6 |
   | `build-log-agent` | every non-fork owned repo → one-line description + lang + date | bulk-batched | Sonnet 4.6 |
   | `projects-agent` | deep per-project research, top ~20 | fan-out × 20 | Sonnet 4.6 |
   | `work-agent` | LinkedIn + intake reconciliation | 1 | Sonnet 4.6 |
   | `education-agent` | intake + LinkedIn | 1 | Sonnet 4.6 |
   | `contact-agent` | socials normalization | 0 (rules) | — |

4. **Assemble** — merges outputs into `Resume`, validates against Zod,
   writes `resumes/{handle}/draft.json` to R2.

## Key differences from the claim pipeline

- **No hook/critic loop.** Resume sections are factual and per-section;
  we don't need the hook evaluator-optimizer.
- **No evidence-binding step.** Facts are sourced per-claim inside each
  agent's output (`sources[]` on project descriptions, etc.) — no
  global artifact dictionary gating.
- **Timeline breadth matters.** Every non-fork owned repo becomes a
  `buildLog` entry, not just the hero set. Cost is managed by bulk
  LLM calls for build-log, reserving per-item research budget for the
  curated projects list.

## Running locally

```bash
cd apps/worker
bun run resume yatendra2001
```

Writes to `profiles/{handle}/resume.json` locally and (when cloud env
vars are present) also to R2 at `resumes/{handle}/draft.json`.
