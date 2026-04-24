#!/usr/bin/env bun
/**
 * Print the Repo Judge verdicts from the KG snapshot.
 *
 * Usage: bun scripts/audit-judge.ts <handle>
 *        bun scripts/audit-judge.ts <handle> --featured  # featured only
 *        bun scripts/audit-judge.ts <handle> --rejected  # !shouldFeature only
 */
import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "../src/util.js";
import { kgLatestKey } from "../src/resume/kg/persist-kg.js";
import type { KnowledgeGraph } from "@gitshow/shared/kg";

const handle = process.argv[2];
if (!handle) {
  console.error(
    "usage: bun scripts/audit-judge.ts <handle> [--featured|--rejected]",
  );
  process.exit(1);
}
const flags = new Set(process.argv.slice(3));

const client = new S3Client({
  region: "auto",
  endpoint: `https://${requireEnv("CF_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  },
});

const resp = await client.send(
  new GetObjectCommand({
    Bucket: requireEnv("R2_BUCKET_NAME"),
    Key: kgLatestKey(handle),
  }),
);
const kg = JSON.parse(await resp.Body!.transformToString()) as KnowledgeGraph;

interface JudgeRow {
  repoFullName: string;
  kind: string;
  polish: string;
  shouldFeature: boolean;
  reason: string;
  filesRead?: number;
}

const rows: JudgeRow[] = [];
for (const [_repoId, raw] of Object.entries(kg.judgments)) {
  const j = raw as Partial<JudgeRow> & {
    repo?: { fullName?: string };
  };
  rows.push({
    repoFullName: j.repo?.fullName ?? j.repoFullName ?? "(unknown)",
    kind: j.kind ?? "(unknown)",
    polish: j.polish ?? "(unknown)",
    shouldFeature: Boolean(j.shouldFeature),
    reason: j.reason ?? "",
    filesRead: j.filesRead,
  });
}

const filtered = rows.filter((r) => {
  if (flags.has("--featured")) return r.shouldFeature;
  if (flags.has("--rejected")) return !r.shouldFeature;
  return true;
});

if (filtered.length === 0) {
  console.log(`No judge verdicts in kg/${handle}/latest.json.`);
  process.exit(0);
}

const featured = rows.filter((r) => r.shouldFeature).length;
console.log(
  `\nJudge verdicts for @${handle} — featured ${featured}/${rows.length}\n`,
);

for (const r of filtered.sort((a, b) => Number(b.shouldFeature) - Number(a.shouldFeature))) {
  const flag = r.shouldFeature ? "★" : "·";
  console.log(
    `  ${flag} [${r.kind.padEnd(22)}] ${r.repoFullName.padEnd(40)} polish=${r.polish}`,
  );
  if (r.reason) console.log(`     ${r.reason.slice(0, 200)}`);
}
console.log("");
