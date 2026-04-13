#!/usr/bin/env node
import { loadSessionReplayData } from "./replay.js";
import { type SurfaceCorpusSummary, summarizeSurfaceCorpus } from "./surfaces.js";

type CliOptions = {
  baselineFiles: string[];
  candidateFiles: string[];
  top?: number;
  json?: boolean;
  help?: boolean;
};

type KindDelta = {
  kind: string;
  baselineChars: number;
  candidateChars: number;
  deltaChars: number;
  deltaPct: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { baselineFiles: [], candidateFiles: [] };
  let currentGroup: "baseline" | "candidate" | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--baseline":
        currentGroup = "baseline";
        break;
      case "--candidate":
        currentGroup = "candidate";
        break;
      case "--top":
        options.top = Number(argv[index + 1] ?? 10);
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (!currentGroup) {
          throw new Error(`Session path must follow --baseline or --candidate: ${arg}`);
        }
        if (currentGroup === "baseline") {
          options.baselineFiles.push(arg);
        } else {
          options.candidateFiles.push(arg);
        }
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.error(
    [
      "Usage: prompt-stability-compare --baseline <session...> --candidate <session...> [options]",
      "",
      "Options:",
      "  --top <n>      number of per-kind deltas to show (default: 10)",
      "  --json         print machine-readable JSON",
      "  --help         show this message",
    ].join("\n"),
  );
}

function ratioDelta(baseline: number, candidate: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : 1;
  return (candidate - baseline) / baseline;
}

function buildKindDeltas(
  baseline: SurfaceCorpusSummary,
  candidate: SurfaceCorpusSummary,
  top: number,
): KindDelta[] {
  const kinds = new Set([
    ...baseline.kindsByChars.map((entry) => entry.kind),
    ...candidate.kindsByChars.map((entry) => entry.kind),
  ]);

  const baselineMap = new Map(baseline.kindsByChars.map((entry) => [entry.kind, entry]));
  const candidateMap = new Map(candidate.kindsByChars.map((entry) => [entry.kind, entry]));

  return [...kinds]
    .map((kind) => {
      const baselineEntry = baselineMap.get(kind);
      const candidateEntry = candidateMap.get(kind);
      const baselineChars = baselineEntry?.totalChars ?? 0;
      const candidateChars = candidateEntry?.totalChars ?? 0;
      return {
        kind,
        baselineChars,
        candidateChars,
        deltaChars: candidateChars - baselineChars,
        deltaPct: ratioDelta(baselineChars, candidateChars),
      };
    })
    .sort((left, right) => Math.abs(right.deltaChars) - Math.abs(left.deltaChars))
    .slice(0, top);
}

function printSummary(
  baseline: SurfaceCorpusSummary,
  candidate: SurfaceCorpusSummary,
  deltas: KindDelta[],
): void {
  console.log("Surface corpus comparison");
  console.log(`  baseline sessions: ${baseline.sessions}`);
  console.log(`  candidate sessions: ${candidate.sessions}`);
  console.log(
    `  injected chars: ${baseline.totalPreFrontierInjectedChars} -> ${candidate.totalPreFrontierInjectedChars} (${candidate.totalPreFrontierInjectedChars - baseline.totalPreFrontierInjectedChars})`,
  );
  console.log(
    `  movable chars: ${baseline.totalMovableChars} -> ${candidate.totalMovableChars} (${candidate.totalMovableChars - baseline.totalMovableChars})`,
  );
  console.log(
    `  total chars: ${baseline.totalChars} -> ${candidate.totalChars} (${candidate.totalChars - baseline.totalChars})`,
  );
  console.log("");
  console.log("Top kind deltas");
  for (const delta of deltas) {
    console.log(
      `  ${delta.kind}: ${delta.baselineChars} -> ${delta.candidateChars} (${delta.deltaChars}, ${(delta.deltaPct * 100).toFixed(1)}%)`,
    );
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help || options.baselineFiles.length === 0 || options.candidateFiles.length === 0) {
  printUsage();
  process.exitCode = options.help ? 0 : 1;
} else {
  const [baselineEntries, candidateEntries] = await Promise.all([
    Promise.all(
      options.baselineFiles.map(async (file) => ({
        path: file,
        events: await loadSessionReplayData(file),
      })),
    ),
    Promise.all(
      options.candidateFiles.map(async (file) => ({
        path: file,
        events: await loadSessionReplayData(file),
      })),
    ),
  ]);

  const baseline = summarizeSurfaceCorpus(baselineEntries, { top: options.top });
  const candidate = summarizeSurfaceCorpus(candidateEntries, { top: options.top });
  const deltas = buildKindDeltas(baseline, candidate, options.top ?? 10);

  if (options.json) {
    console.log(JSON.stringify({ baseline, candidate, deltas }, null, 2));
  } else {
    printSummary(baseline, candidate, deltas);
  }
}
