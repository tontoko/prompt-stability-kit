#!/usr/bin/env node
import { loadSessionReplayData } from "./replay.js";
import { summarizeSurfaceCorpus } from "./surfaces.js";

type CliOptions = {
  files: string[];
  top?: number;
  json?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { files: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
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
        options.files.push(arg);
        break;
    }
  }

  return options;
}

function printUsage(): void {
  console.error(
    [
      "Usage: prompt-stability-surfaces <session.jsonl> [more sessions...] [options]",
      "",
      "Options:",
      "  --top <n>      number of kinds/sessions to show (default: 10)",
      "  --json         print machine-readable JSON",
      "  --help         show this message",
    ].join("\n"),
  );
}

function printSummary(summary: ReturnType<typeof summarizeSurfaceCorpus>): void {
  console.log("Surface corpus summary");
  console.log(`  sessions: ${summary.sessions}`);
  console.log(`  messages: ${summary.totalMessages}`);
  console.log(`  blocks: ${summary.totalBlocks}`);
  console.log(`  chars: ${summary.totalChars}`);
  console.log(`  movable chars: ${summary.totalMovableChars}`);
  console.log(`  future-only chars: ${summary.totalFutureOnlyChars}`);
  console.log(`  pre-frontier injected chars: ${summary.totalPreFrontierInjectedChars}`);
  console.log("");

  console.log("Kinds by chars");
  for (const stats of summary.kindsByChars) {
    console.log(
      `  ${stats.kind}: count=${stats.count} chars=${stats.totalChars} avg=${stats.averageChars} movable=${stats.movableChars} injected=${stats.preFrontierInjectedChars}`,
    );
  }
  console.log("");

  console.log("Sessions by chars");
  for (const session of summary.sessionSummaries.slice(0, 10)) {
    console.log(
      `  ${session.sessionId ?? "unknown"}: chars=${session.totalChars} injected=${session.totalPreFrontierInjectedChars} movable=${session.totalMovableChars}`,
    );
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help || options.files.length === 0) {
  printUsage();
  process.exitCode = options.help ? 0 : 1;
} else {
  const entries = await Promise.all(
    options.files.map(async (file) => ({
      path: file,
      events: await loadSessionReplayData(file),
    })),
  );

  const summary = summarizeSurfaceCorpus(entries, { top: options.top });
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }
}
