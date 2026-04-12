import { readFile } from "node:fs/promises";

import type { DiagnosticsSnapshot } from "@tontoko/prompt-stability-core";

export async function loadDiagnostics(path: string): Promise<DiagnosticsSnapshot[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as DiagnosticsSnapshot);
}

export function summarizeDiagnostics(events: DiagnosticsSnapshot[]): Record<string, unknown> {
  const severeBreaks = events.filter(
    (event) => event.promptCache?.observation?.broke === true,
  ).length;
  const blockCounts = events.reduce<Record<string, number>>((acc, event) => {
    for (const [kind, count] of Object.entries(event.blockCounts)) {
      acc[kind] = (acc[kind] ?? 0) + (count ?? 0);
    }
    return acc;
  }, {});
  return {
    totalEvents: events.length,
    severeBreaks,
    aggregateBlockCounts: blockCounts,
  };
}
