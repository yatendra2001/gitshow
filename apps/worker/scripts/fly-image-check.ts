#!/usr/bin/env bun
import "dotenv/config";
import { FlyClient } from "../src/cloud/fly.js";

const fly = FlyClient.fromEnv();
const image = await fly.getCurrentImage();
console.log(image);
