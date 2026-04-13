#!/usr/bin/env node
import { loadSessionReplayData, replaySession } from "./replay.js";

type CliOptions = {
  file?: string;
  top?: number;
  json?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

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
        if (!options.file) {
          options.file = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  console.error(
    [
      "Usage: prompt-stability-replay <session.jsonl> [options]",
      "",
      "Options:",
      "  --top <n>      number of turns to show in uplift ranking (default: 10)",
      "  --json         print machine-readable JSON",
      "  --help         show this message",
    ].join("\n"),
  );
}

const options = parseArgs(process.argv.slice(2));

if (options.help || !options.file) {
  printUsage();
  process.exitCode = options.help ? 0 : 1;
} else {
  const events = await loadSessionReplayData(options.file);
  const result = replaySession(events, { top: options.top });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Replay summary");
    console.log(`  sessionId: ${result.summary.sessionId ?? "unknown"}`);
    console.log(`  turns: ${result.summary.totalTurns}`);
    console.log(
      `  actual cache ratio: ${(result.summary.actualCacheReadRatio * 100).toFixed(2)}% (${result.summary.totalActualCacheReadTokens}/${result.summary.totalActualInputTokens})`,
    );
    console.log(
      `  baseline append-only turns: ${result.summary.baselineAppendOnlyTurns}/${result.summary.totalTurns}`,
    );
    console.log(
      `  optimized append-only turns: ${result.summary.optimizedAppendOnlyTurns}/${result.summary.totalTurns}`,
    );
    console.log(
      `  turns where current-turn reorder cannot help: ${result.summary.turnsWhereCurrentTurnReorderCannotHelp}/${result.summary.totalTurns}`,
    );
    console.log(
      `  turns with potential current-turn benefit: ${result.summary.turnsWithPotentialCurrentTurnBenefit}/${result.summary.totalTurns}`,
    );
    console.log(`  baseline prefix chars avg: ${result.summary.averageBaselinePrefixChars}`);
    console.log(`  optimized prefix chars avg: ${result.summary.averageOptimizedPrefixChars}`);
    console.log(`  avg uplift chars: ${result.summary.averageUpliftChars}`);
    console.log(`  turns with positive uplift: ${result.summary.turnsWithPositiveUplift}`);
    console.log("");
    console.log("Top turns by uplift");
    for (const turn of result.summary.topTurnsByUplift) {
      console.log(
        `  turn=${turn.turnIndex} uplift=${turn.upliftChars} baseline=${turn.baselinePrefixChars} optimized=${turn.optimizedPrefixChars} moved=${turn.movedBlocks} cache=${(turn.actualCacheReadRatio * 100).toFixed(2)}%`,
      );
    }
  }
}
