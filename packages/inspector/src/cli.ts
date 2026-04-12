#!/usr/bin/env node
import { loadDiagnostics, summarizeDiagnostics } from "./index.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: prompt-stability-inspector <telemetry.jsonl>");
  process.exitCode = 1;
} else {
  const events = await loadDiagnostics(file);
  console.log(JSON.stringify(summarizeDiagnostics(events), null, 2));
}
