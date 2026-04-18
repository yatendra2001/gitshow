#!/usr/bin/env bun
import "dotenv/config";
import { R2Client } from "../src/cloud/r2.js";

const r2 = R2Client.fromEnv();
const scanId = `__healthcheck_${Date.now()}`;
const filename = "ping.json";
const payload = { at: new Date().toISOString(), msg: "r2 round-trip" };

console.log(`put    scans/${scanId}/${filename}`);
await r2.uploadStageFile(scanId, filename, payload);

console.log(`list   scans/${scanId}/…`);
const keys = await r2.listScanKeys(scanId);
console.log("  →", keys);

const got = await r2.downloadKey(keys[0]!);
console.log("get    →", got);

console.log("ok");
