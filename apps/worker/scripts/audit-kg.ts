#!/usr/bin/env bun
/**
 * Pretty-print a handle's KG snapshot from R2 (kg/{handle}/latest.json).
 *
 * Usage: bun scripts/audit-kg.ts <handle>
 *        bun scripts/audit-kg.ts <handle> --raw    # full JSON dump
 *        bun scripts/audit-kg.ts <handle> --edges  # full edge listing
 */
import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "../src/util.js";
import {
  kgLatestKey,
} from "../src/resume/kg/persist-kg.js";
import type { KnowledgeGraph, Edge } from "@gitshow/shared/kg";

const handle = process.argv[2];
if (!handle) {
  console.error("usage: bun scripts/audit-kg.ts <handle> [--raw|--edges]");
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
const body = await resp.Body!.transformToString();

if (flags.has("--raw")) {
  console.log(body);
  process.exit(0);
}

const kg = JSON.parse(body) as KnowledgeGraph;
const e = kg.entities;

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  KG @${kg.meta.handle}  ·  scan ${kg.meta.scanId}`);
console.log(
  `  ${new Date(kg.meta.startedAt).toISOString()}  ·  ${(
    (kg.meta.finishedAt - kg.meta.startedAt) /
    1000
  ).toFixed(1)}s`,
);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

console.log(`Entities`);
console.log(`  persons       ${e.persons.length}`);
console.log(`  companies     ${e.companies.length}`);
console.log(`  schools       ${e.schools.length}`);
console.log(`  roles         ${e.roles.length}`);
console.log(`  projects      ${e.projects.length}`);
console.log(`  repositories  ${e.repositories.length}`);
console.log(`  skills        ${e.skills.length}`);
console.log(`  publications  ${e.publications.length}`);
console.log(`  achievements  ${e.achievements.length}`);
console.log(`  events        ${e.events.length}`);
console.log(`  mediaAssets   ${e.mediaAssets.length}`);
console.log(`  edges         ${kg.edges.length}`);
console.log(`  resolutions   ${kg.resolved.pairs.length}\n`);

if (e.persons.length > 0) {
  const p = e.persons[0]!;
  console.log(`Person  @${p.handle}`);
  if (p.name) console.log(`  name      ${p.name}`);
  if (p.location) console.log(`  location  ${p.location}`);
  if (p.email) console.log(`  email     ${p.email}`);
  if (p.bio) console.log(`  bio       ${p.bio.slice(0, 120)}…`);
  console.log("");
}

const byBand = (band: string) =>
  kg.edges.filter((edge) => edge.band === band).length;
console.log(`Edges by confidence band`);
console.log(`  verified  ${byBand("verified")}`);
console.log(`  likely    ${byBand("likely")}`);
console.log(`  suggested ${byBand("suggested")}\n`);

const byType = new Map<string, number>();
for (const edge of kg.edges) {
  byType.set(edge.type, (byType.get(edge.type) ?? 0) + 1);
}
console.log(`Edges by type`);
for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(20)} ${n}`);
}
console.log("");

if (e.projects.length > 0) {
  const featured = e.projects.filter((p) => p.shouldFeature).length;
  console.log(`Projects (featured ${featured}/${e.projects.length})`);
  for (const p of e.projects.slice(0, 12)) {
    const flag = p.shouldFeature ? "★" : "·";
    console.log(
      `  ${flag} [${p.kind.padEnd(20)}] ${p.title}  (${p.polish})`,
    );
  }
  if (e.projects.length > 12) {
    console.log(`  … +${e.projects.length - 12} more`);
  }
  console.log("");
}

if (kg.warnings.length > 0) {
  console.log(`Warnings (${kg.warnings.length})`);
  for (const w of kg.warnings.slice(0, 8)) console.log(`  - ${w}`);
  console.log("");
}

if (flags.has("--edges")) {
  console.log(`All edges:`);
  for (const edge of kg.edges as Edge[]) {
    const attrs = Object.entries(edge.attrs)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 32)}`)
      .join(" ");
    console.log(
      `  [${edge.band.padEnd(9)}] ${edge.type.padEnd(18)} ${edge.from} → ${edge.to}  ${attrs}`,
    );
  }
}
