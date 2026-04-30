import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { formatSample, sampleRepo } from "./repo-sampler.js";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "gitshow-repo-sampler-"));
}

describe("repo corpus sampler", () => {
  test("reads all eligible first-party files for small repos", async () => {
    const root = await tempRepo();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules/pkg"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Demo\nA useful app.");
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { next: "latest" } }));
    await writeFile(join(root, ".env"), "TOKEN=should-not-be-read");
    await writeFile(join(root, "node_modules/pkg/index.js"), "export const vendored = true;");
    for (let i = 0; i < 7; i++) {
      await writeFile(join(root, "src", `file-${i}.ts`), `export const value${i} = ${i};\n`);
    }

    const sample = await sampleRepo(root);
    const paths = sample.files.map((file) => file.path);

    expect(sample.stats.fullCoverage).toBe(true);
    expect(sample.stats.skippedSensitive).toBe(1);
    expect(paths).toContain("src/file-0.ts");
    expect(paths).toContain("src/file-6.ts");
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(sample.chunks.length).toBeGreaterThanOrEqual(7);
  });

  test("uses prioritized coverage for repos beyond the full-read budget", async () => {
    const root = await tempRepo();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Large Demo\n");
    const largeSource = `export const block = "${"x".repeat(740_000)}";\n`;
    for (let i = 0; i < 6; i++) {
      await writeFile(join(root, "src", `large-${i}.ts`), largeSource);
    }

    const sample = await sampleRepo(root);

    expect(sample.stats.tier).toBe("prioritized");
    expect(sample.stats.fullCoverage).toBe(false);
    expect(sample.stats.eligibleFiles).toBeGreaterThan(sample.stats.analyzedFiles);
    expect(sample.stats.analyzedBytes).toBeLessThanOrEqual(4_000_000);
  });

  test("formats judge input without raw source chunks", async () => {
    const root = await tempRepo();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Demo\n");
    await writeFile(join(root, "src", "secret-free.ts"), "export const uniqueImplementationToken = 42;\n");

    const sample = await sampleRepo(root);
    const formatted = formatSample(sample, {
      findings: [],
      fileSummaries: [
        {
          path: "src/secret-free.ts",
          bytes: 44,
          chunks: 1,
          summary: "Defines the core implementation token.",
          technologies: ["TypeScript"],
          signals: ["Core implementation lives in source."],
          risks: [],
        },
      ],
      technologies: ["TypeScript"],
      repoSignals: ["Core implementation lives in source."],
      risks: [],
      analyzedBatches: 1,
      failedBatches: 0,
    });

    expect(formatted).toContain("<repo_coverage");
    expect(formatted).toContain("<file_summary path=\"src/secret-free.ts\"");
    expect(formatted).not.toContain("uniqueImplementationToken");
  });
});
