#!/usr/bin/env node
import { applyAllPatches, resolveDistDir } from "./lib/openclaw-core-compaction.mjs";

const distDir = resolveDistDir(process.argv.slice(2));
const results = await applyAllPatches(distDir);

for (const result of results) {
  console.log(`${result.changed ? "patched" : "ok"} ${result.filePath}`);
}
