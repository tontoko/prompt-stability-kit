#!/usr/bin/env node
import { resolveDistDir, verifyAllPatches } from "./lib/openclaw-core-compaction.mjs";

const distDir = resolveDistDir(process.argv.slice(2));
const { ok, results } = await verifyAllPatches(distDir);

for (const result of results) {
  if (!result.passes) {
    console.error(
      `mismatch ${result.filePath}: fromCount=${result.fromCount} toCount=${result.toCount}`,
    );
  }
}

if (!ok) {
  process.exitCode = 1;
} else {
  console.log(`verified ${results.length} replacement markers in ${distDir}`);
}
