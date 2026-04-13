import { normalizeMessages } from "@tontoko/openclaw-stable-prefix-context";
import {
  type CorePolicyConfig,
  defaultSliceabilityForKind,
  type PromptStabilityBlockKind,
} from "@tontoko/prompt-stability-core";

import type { SessionEnvelope } from "./replay.js";

export type SurfaceKindStats = {
  kind: PromptStabilityBlockKind;
  count: number;
  totalChars: number;
  averageChars: number;
  maxChars: number;
  movableCount: number;
  movableChars: number;
  futureOnlyCount: number;
  futureOnlyChars: number;
  preFrontierInjectedCount: number;
  preFrontierInjectedChars: number;
};

export type SessionSurfaceSummary = {
  sessionId?: string;
  totalMessages: number;
  totalBlocks: number;
  totalChars: number;
  totalMovableChars: number;
  totalFutureOnlyChars: number;
  totalPreFrontierInjectedChars: number;
  kindsByChars: SurfaceKindStats[];
};

export type SurfaceCorpusSummary = {
  sessions: number;
  totalMessages: number;
  totalBlocks: number;
  totalChars: number;
  totalMovableChars: number;
  totalFutureOnlyChars: number;
  totalPreFrontierInjectedChars: number;
  kindsByChars: SurfaceKindStats[];
  sessionSummaries: SessionSurfaceSummary[];
};

type AnalyzeOptions = {
  config?: CorePolicyConfig;
  top?: number;
};

type MutableSurfaceKindStats = Omit<SurfaceKindStats, "averageChars"> & {
  averageChars?: number;
};

const DEFAULT_PRE_FRONTIER_INJECTED_KINDS = new Set<PromptStabilityBlockKind>([
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
]);

function resolvePreFrontierInjectedKinds(
  config: CorePolicyConfig | undefined,
): Set<PromptStabilityBlockKind> {
  return new Set(config?.preFrontierInjectedKinds ?? [...DEFAULT_PRE_FRONTIER_INJECTED_KINDS]);
}

function makeEmptyStats(kind: PromptStabilityBlockKind): MutableSurfaceKindStats {
  return {
    kind,
    count: 0,
    totalChars: 0,
    maxChars: 0,
    movableCount: 0,
    movableChars: 0,
    futureOnlyCount: 0,
    futureOnlyChars: 0,
    preFrontierInjectedCount: 0,
    preFrontierInjectedChars: 0,
  };
}

function finalizeStats(stats: MutableSurfaceKindStats): SurfaceKindStats {
  return {
    ...stats,
    averageChars: stats.count > 0 ? Math.round(stats.totalChars / stats.count) : 0,
  };
}

function sortStatsByChars(
  stats: Iterable<MutableSurfaceKindStats>,
  top: number | undefined,
): SurfaceKindStats[] {
  const values = [...stats]
    .map(finalizeStats)
    .sort(
      (left, right) => right.totalChars - left.totalChars || left.kind.localeCompare(right.kind),
    );
  return typeof top === "number" ? values.slice(0, top) : values;
}

export function analyzeSessionSurfaces(
  events: SessionEnvelope[],
  options: AnalyzeOptions = {},
): SessionSurfaceSummary {
  const transcript: Array<Record<string, unknown>> = [];
  let sessionId: string | undefined;

  for (const event of events) {
    if (event.type === "session" && typeof event.id === "string") {
      sessionId = event.id;
    }
    if (event.type === "message" && event.message) {
      transcript.push(event.message as Record<string, unknown>);
    }
  }

  const preFrontierInjectedKinds = resolvePreFrontierInjectedKinds(options.config);
  const blocks = normalizeMessages(transcript, options.config);
  const kindStats = new Map<PromptStabilityBlockKind, MutableSurfaceKindStats>();

  let totalChars = 0;
  let totalMovableChars = 0;
  let totalFutureOnlyChars = 0;
  let totalPreFrontierInjectedChars = 0;

  for (const block of blocks) {
    const charLength = block.text.length;
    totalChars += charLength;

    let stats = kindStats.get(block.kind);
    if (!stats) {
      stats = makeEmptyStats(block.kind);
      kindStats.set(block.kind, stats);
    }

    stats.count += 1;
    stats.totalChars += charLength;
    stats.maxChars = Math.max(stats.maxChars, charLength);

    const sliceability =
      block.sliceability ?? defaultSliceabilityForKind(block.kind, options.config);
    if (
      sliceability === "lossless_whole_movable" ||
      sliceability === "lossless_split_child_movable"
    ) {
      stats.movableCount += 1;
      stats.movableChars += charLength;
      totalMovableChars += charLength;
    }

    if (sliceability === "future_only") {
      stats.futureOnlyCount += 1;
      stats.futureOnlyChars += charLength;
      totalFutureOnlyChars += charLength;
    }

    if (preFrontierInjectedKinds.has(block.kind)) {
      stats.preFrontierInjectedCount += 1;
      stats.preFrontierInjectedChars += charLength;
      totalPreFrontierInjectedChars += charLength;
    }
  }

  return {
    sessionId,
    totalMessages: transcript.length,
    totalBlocks: blocks.length,
    totalChars,
    totalMovableChars,
    totalFutureOnlyChars,
    totalPreFrontierInjectedChars,
    kindsByChars: sortStatsByChars(kindStats.values(), options.top),
  };
}

export function summarizeSurfaceCorpus(
  entries: Array<{ path: string; events: SessionEnvelope[] }>,
  options: AnalyzeOptions = {},
): SurfaceCorpusSummary {
  const top = options.top;
  const aggregateStats = new Map<PromptStabilityBlockKind, MutableSurfaceKindStats>();
  const sessionSummaries = entries.map(({ events }) => analyzeSessionSurfaces(events, options));

  let totalMessages = 0;
  let totalBlocks = 0;
  let totalChars = 0;
  let totalMovableChars = 0;
  let totalFutureOnlyChars = 0;
  let totalPreFrontierInjectedChars = 0;

  for (const session of sessionSummaries) {
    totalMessages += session.totalMessages;
    totalBlocks += session.totalBlocks;
    totalChars += session.totalChars;
    totalMovableChars += session.totalMovableChars;
    totalFutureOnlyChars += session.totalFutureOnlyChars;
    totalPreFrontierInjectedChars += session.totalPreFrontierInjectedChars;

    for (const stats of session.kindsByChars) {
      let aggregate = aggregateStats.get(stats.kind);
      if (!aggregate) {
        aggregate = makeEmptyStats(stats.kind);
        aggregateStats.set(stats.kind, aggregate);
      }

      aggregate.count += stats.count;
      aggregate.totalChars += stats.totalChars;
      aggregate.maxChars = Math.max(aggregate.maxChars, stats.maxChars);
      aggregate.movableCount += stats.movableCount;
      aggregate.movableChars += stats.movableChars;
      aggregate.futureOnlyCount += stats.futureOnlyCount;
      aggregate.futureOnlyChars += stats.futureOnlyChars;
      aggregate.preFrontierInjectedCount += stats.preFrontierInjectedCount;
      aggregate.preFrontierInjectedChars += stats.preFrontierInjectedChars;
    }
  }

  return {
    sessions: sessionSummaries.length,
    totalMessages,
    totalBlocks,
    totalChars,
    totalMovableChars,
    totalFutureOnlyChars,
    totalPreFrontierInjectedChars,
    kindsByChars: sortStatsByChars(aggregateStats.values(), top),
    sessionSummaries: sessionSummaries.sort(
      (left, right) =>
        right.totalChars - left.totalChars ||
        (left.sessionId ?? "").localeCompare(right.sessionId ?? ""),
    ),
  };
}
