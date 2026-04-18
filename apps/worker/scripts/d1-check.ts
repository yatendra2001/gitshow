#!/usr/bin/env bun
import "dotenv/config";
import { D1Client } from "../src/cloud/d1.js";

const d1 = D1Client.fromEnv();
const resp = await d1.query(
  `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
);
console.log(JSON.stringify(resp.result?.[0]?.results, null, 2));
