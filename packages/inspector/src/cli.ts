#!/usr/bin/env node
import { loadDiagnostics, summarizeDiagnostics } from "./index.js";

type CliOptions = {
  file?: string;
  sessionId?: string;
  top?: number;
  json?: boolean;
  help?: boolean;
};

function printUsage(): void {
  console.error(
    [
      "Usage: prompt-stability-inspector <telemetry.jsonl> [options]",
      "",
      "Options:",
      "  --session <session-id>   limit output to one session",
      "  --top <n>                number of sessions/hotspots to show (default: 5)",
      "  --json                   print machine-readable JSON",
      "  --help                   show this message",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--session":
        options.sessionId = argv[index + 1];
        index += 1;
        break;
      case "--top":
        options.top = Number(argv[index + 1] ?? 5);
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
        if (!options.file) {
          options.file = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function printTextSummary(summary: ReturnType<typeof summarizeDiagnostics>): void {
  console.log("Overview");
  console.log(`  Events: ${summary.totalEvents}`);
  console.log(`  Sessions: ${summary.sessions}`);
  console.log(`  Assemble events: ${summary.assembleEvents}`);
  console.log(`  Usage events: ${summary.usageEvents}`);
  console.log(`  Severe cache breaks: ${summary.severeBreaks}`);
  console.log(
    `  Cache-read ratio: ${formatPercent(summary.cacheReadRatio)} (${summary.totalCacheReadTokens}/${summary.totalInputTokens})`,
  );
  console.log(`  Decision counts: ${JSON.stringify(summary.decisionCounts)}`);
  console.log("");

  console.log("Divergence hotspots");
  if (summary.divergenceHotspots.length === 0) {
    console.log("  none");
  } else {
    for (const hotspot of summary.divergenceHotspots) {
      console.log(`  ${hotspot.kind}: ${hotspot.count}`);
    }
  }
  console.log("");

  console.log("Top sessions by input");
  if (summary.sessionsByInput.length === 0) {
    console.log("  none");
  } else {
    for (const session of summary.sessionsByInput) {
      console.log(`  ${session.sessionId}`);
      console.log(
        `    input=${session.totalInputTokens} cacheRead=${session.totalCacheReadTokens} ratio=${formatPercent(session.cacheReadRatio)}`,
      );
      console.log(
        `    severeBreaks=${session.severeBreaks} divergenceCount=${session.divergenceCount} decisionCounts=${JSON.stringify(session.decisionCounts)}`,
      );
      if (session.topDivergenceKinds.length > 0) {
        console.log(
          `    hotspots=${session.topDivergenceKinds.map((item) => `${item.kind}:${item.count}`).join(", ")}`,
        );
      }
    }
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.help || !options.file) {
  printUsage();
  process.exitCode = options.help ? 0 : 1;
} else {
  const events = await loadDiagnostics(options.file);
  const summary = summarizeDiagnostics(events, {
    sessionId: options.sessionId,
    top: options.top,
  });

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printTextSummary(summary);
  }
}
