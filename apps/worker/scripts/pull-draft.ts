#!/usr/bin/env bun
/**
 * Read the draft resume JSON from R2 for diagnosis.
 *
 * Usage: bun scripts/pull-draft.ts <handle>
 */
import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "../src/util.js";

const handle = process.argv[2];
if (!handle) {
  console.error("usage: bun scripts/pull-draft.ts <handle>");
  process.exit(1);
}

const accountId = requireEnv("CF_ACCOUNT_ID");
const bucket = requireEnv("R2_BUCKET_NAME");
const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const key = `resumes/${handle.toLowerCase()}/draft.json`;
const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
const body = await resp.Body!.transformToString();
const j = JSON.parse(body);

console.log(`== ${key} (${body.length} bytes) ==\n`);
console.log("Top-level keys:");
for (const k of Object.keys(j)) {
  const v = j[k];
  if (Array.isArray(v)) console.log(`  ${k}: [${v.length}]`);
  else if (typeof v === "string") console.log(`  ${k}: "${v.slice(0, 80)}${v.length > 80 ? "…" : ""}"`);
  else if (v && typeof v === "object") console.log(`  ${k}: {${Object.keys(v).length} keys}`);
  else console.log(`  ${k}: ${JSON.stringify(v)}`);
}

console.log("\n== sections ==");
for (const section of ["work", "education", "projects", "skills", "blog", "build_log", "featured", "person", "hero", "about"]) {
  const v = (j as Record<string, unknown>)[section];
  if (v == null) continue;
  if (Array.isArray(v)) {
    console.log(`\n-- ${section} [${v.length}] --`);
    if (v.length > 0) console.log(JSON.stringify(v[0], null, 2).slice(0, 800));
  } else if (typeof v === "object") {
    console.log(`\n-- ${section} --`);
    console.log(JSON.stringify(v, null, 2).slice(0, 800));
  }
}
