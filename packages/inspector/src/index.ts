import { readFile } from "node:fs/promises";

import type {
  DiagnosticsSnapshot,
  PromptStabilityBlockKind,
  PromptStabilityDecision,
} from "@tontoko/prompt-stability-core";

type UsageSnapshot = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

export type SessionSummary = {
  sessionId: string;
  eventCount: number;
  assembleEvents: number;
  usageEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  cacheReadRatio: number;
  severeBreaks: number;
  divergenceCount: number;
  topDivergenceKinds: Array<{ kind: string; count: number }>;
  decisionCounts: Partial<Record<PromptStabilityDecision, number>>;
};

export type DiagnosticsSummary = {
  totalEvents: number;
  sessions: number;
  assembleEvents: number;
  usageEvents: number;
  severeBreaks: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  cacheReadRatio: number;
  divergenceHotspots: Array<{ kind: string; count: number }>;
  decisionCounts: Partial<Record<PromptStabilityDecision, number>>;
  sessionsByInput: SessionSummary[];
};

type SummarizeOptions = {
  sessionId?: string;
  top?: number;
};

function normalizeLine(line: string): DiagnosticsSnapshot {
  return JSON.parse(line) as DiagnosticsSnapshot;
}

function getUsage(event: DiagnosticsSnapshot): UsageSnapshot | undefined {
  const usage = (event.promptCache as { lastCallUsage?: Partial<UsageSnapshot> } | undefined)
    ?.lastCallUsage;
  if (!usage) return undefined;
  return {
    input: Number(usage.input ?? 0),
    output: Number(usage.output ?? 0),
    cacheRead: Number(usage.cacheRead ?? 0),
    cacheWrite: Number(usage.cacheWrite ?? 0),
    total: Number(usage.total ?? 0),
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function increment<K extends string>(
  map: Partial<Record<K, number>>,
  key: K | undefined,
  amount = 1,
): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + amount;
}

function topCounts<K extends string>(
  map: Partial<Record<K, number>>,
  top: number,
): Array<{ kind: string; count: number }> {
  return Object.entries(map)
    .map(([kind, count]) => ({ kind, count: Number(count ?? 0) }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .slice(0, top);
}

export async function loadDiagnostics(path: string): Promise<DiagnosticsSnapshot[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map(normalizeLine);
}

export * from "./replay.js";
export * from "./surfaces.js";

export function summarizeDiagnostics(
  events: DiagnosticsSnapshot[],
  options: SummarizeOptions = {},
): DiagnosticsSummary {
  const filtered = options.sessionId
    ? events.filter((event) => event.sessionId === options.sessionId)
    : events;
  const top = options.top ?? 5;

  const divergenceCounts: Partial<Record<PromptStabilityBlockKind | "unknown", number>> = {};
  const decisionCounts: Partial<Record<PromptStabilityDecision, number>> = {};
  const sessions = new Map<string, SessionSummary>();

  let assembleEvents = 0;
  let usageEvents = 0;
  let severeBreaks = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalTokens = 0;

  for (const event of filtered) {
    const sessionId = event.sessionId ?? "unknown-session";
    const isAssembleEvent =
      event.estimatedChars > 0 ||
      Boolean(event.firstDivergence) ||
      Object.keys(event.blockCounts ?? {}).length > 0 ||
      Object.keys(event.decisionCounts ?? {}).length > 0;
    const usage = getUsage(event);
    const broke = event.promptCache?.observation?.broke === true;

    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        eventCount: 0,
        assembleEvents: 0,
        usageEvents: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalTokens: 0,
        cacheReadRatio: 0,
        severeBreaks: 0,
        divergenceCount: 0,
        topDivergenceKinds: [] as Array<{ kind: string; count: number }>,
        decisionCounts: {},
      };
      sessions.set(sessionId, session);
    }

    session.eventCount += 1;

    if (isAssembleEvent) {
      assembleEvents += 1;
      session.assembleEvents += 1;
    }

    if (usage) {
      usageEvents += 1;
      totalInputTokens += usage.input;
      totalOutputTokens += usage.output;
      totalCacheReadTokens += usage.cacheRead;
      totalCacheWriteTokens += usage.cacheWrite;
      totalTokens += usage.total;

      session.usageEvents += 1;
      session.totalInputTokens += usage.input;
      session.totalOutputTokens += usage.output;
      session.totalCacheReadTokens += usage.cacheRead;
      session.totalCacheWriteTokens += usage.cacheWrite;
      session.totalTokens += usage.total;
    }

    if (broke) {
      severeBreaks += 1;
      session.severeBreaks += 1;
    }

    if (event.firstDivergence) {
      session.divergenceCount += 1;
      increment(
        divergenceCounts,
        event.firstDivergence.currentKind ?? event.firstDivergence.previousKind ?? "unknown",
      );
    }

    for (const [decision, count] of Object.entries(event.decisionCounts ?? {})) {
      increment(decisionCounts, decision as PromptStabilityDecision, Number(count ?? 0));
      increment(session.decisionCounts, decision as PromptStabilityDecision, Number(count ?? 0));
    }
  }

  const sessionSummaries: SessionSummary[] = Array.from(sessions.values())
    .map(
      (session): SessionSummary => ({
        ...session,
        cacheReadRatio: ratio(session.totalCacheReadTokens, session.totalInputTokens),
        topDivergenceKinds: [],
      }),
    )
    .sort((a, b) => {
      if (b.totalInputTokens !== a.totalInputTokens) return b.totalInputTokens - a.totalInputTokens;
      if (b.severeBreaks !== a.severeBreaks) return b.severeBreaks - a.severeBreaks;
      return a.sessionId.localeCompare(b.sessionId);
    });

  const perSessionHotspots = new Map<string, Partial<Record<string, number>>>();
  for (const event of filtered) {
    const sessionId = event.sessionId ?? "unknown-session";
    if (!event.firstDivergence) continue;
    const perSession = perSessionHotspots.get(sessionId) ?? {};
    increment(
      perSession,
      event.firstDivergence.currentKind ?? event.firstDivergence.previousKind ?? "unknown",
    );
    perSessionHotspots.set(sessionId, perSession);
  }

  for (const session of sessionSummaries) {
    session.topDivergenceKinds = topCounts(perSessionHotspots.get(session.sessionId) ?? {}, top);
  }

  return {
    totalEvents: filtered.length,
    sessions: sessionSummaries.length,
    assembleEvents,
    usageEvents,
    severeBreaks,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalTokens,
    cacheReadRatio: ratio(totalCacheReadTokens, totalInputTokens),
    divergenceHotspots: topCounts(divergenceCounts, top),
    decisionCounts,
    sessionsByInput: sessionSummaries.slice(0, top),
  };
}
