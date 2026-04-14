import { readFile } from "node:fs/promises";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  analyzeMaintenanceCandidateForMessage,
  buildCompactedText,
  normalizeMessages,
  type StablePrefixPluginConfig,
  simulateFutureChurnMaintenance,
} from "@tontoko/openclaw-stable-prefix-context";
import {
  applyPreFrontierInjectionPolicy,
  computeFirstDivergence,
  computePreFrontierInjectionPolicy,
  type EnrichedBlock,
  enrichBlocks,
  type FirstDivergence,
  type PromptStabilityDecision,
} from "@tontoko/prompt-stability-core";

export type SessionEnvelope = {
  type?: string;
  id?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    provider?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ReplayTurn = {
  turnIndex: number;
  assistantMessageId?: string;
  provider?: string;
  model?: string;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCacheReadTokens: number;
  actualCacheReadRatio: number;
  baselineAppendOnly: boolean;
  optimizedAppendOnly: boolean;
  currentTurnBenefitPossible: boolean;
  baselinePrefixChars: number;
  optimizedPrefixChars: number;
  upliftChars: number;
  maintenanceAdjustedPrefixChars: number;
  maintenanceAdjustedAppendOnly: boolean;
  maintenanceUpliftChars: number;
  maintenanceBytesFreedApplied: number;
  maintenanceRewritesApplied: number;
  baselineFirstDivergence?: FirstDivergence;
  optimizedFirstDivergence?: FirstDivergence;
  maintenanceAdjustedFirstDivergence?: FirstDivergence;
  movedBlocks: number;
  movedStableIds: string[];
  decisionCounts: Partial<Record<PromptStabilityDecision, number>>;
  potentialMaintenanceBytesFreed: number;
  potentialMaintenanceRewrites: number;
};

export type ReplaySummary = {
  sessionId?: string;
  totalTurns: number;
  turnsWithActualUsage: number;
  totalActualInputTokens: number;
  totalActualCacheReadTokens: number;
  actualCacheReadRatio: number;
  totalBaselinePrefixChars: number;
  totalOptimizedPrefixChars: number;
  totalUpliftChars: number;
  averageBaselinePrefixChars: number;
  averageOptimizedPrefixChars: number;
  averageUpliftChars: number;
  turnsWithPositiveUplift: number;
  totalMaintenanceAdjustedPrefixChars: number;
  averageMaintenanceAdjustedPrefixChars: number;
  totalMaintenanceUpliftChars: number;
  averageMaintenanceUpliftChars: number;
  turnsWithPositiveMaintenanceUplift: number;
  maintenanceAdjustedAppendOnlyTurns: number;
  totalAppliedMaintenanceBytesFreed: number;
  totalAppliedMaintenanceRewrites: number;
  baselineAppendOnlyTurns: number;
  optimizedAppendOnlyTurns: number;
  turnsWhereCurrentTurnReorderCannotHelp: number;
  turnsWithPotentialCurrentTurnBenefit: number;
  totalPotentialMaintenanceBytesFreed: number;
  totalPotentialMaintenanceRewrites: number;
  turnsWithPotentialMaintenanceBenefit: number;
  topTurnsByUplift: ReplayTurn[];
};

type ReplayOptions = {
  config?: StablePrefixPluginConfig;
  top?: number;
};

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function prefixChars<T extends { text?: string; assembledText?: string }>(
  blocks: T[],
  firstDivergence: FirstDivergence | undefined,
): number {
  const boundary = firstDivergence?.index ?? blocks.length;
  return blocks
    .slice(0, boundary)
    .reduce((sum, block) => sum + (block.assembledText ?? block.text ?? "").length, 0);
}

function serializeEnriched(blocks: EnrichedBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

function isAppendOnly(previous: string | undefined, current: string): boolean {
  if (!previous) return false;
  return current.startsWith(previous);
}

function countMovedBlocks(original: EnrichedBlock[], optimized: EnrichedBlock[]) {
  const originalOrder = new Map(original.map((block, index) => [block.stableId, index]));
  const movedStableIds = optimized
    .map((block, index) => ({ stableId: block.stableId, index }))
    .filter(({ stableId, index }) => originalOrder.get(stableId) !== index)
    .map(({ stableId }) => stableId);

  return {
    movedBlocks: movedStableIds.length,
    movedStableIds,
  };
}

function countDecisions(
  blocks: Array<{ decision: string }>,
): Partial<Record<PromptStabilityDecision, number>> {
  return blocks.reduce<Partial<Record<PromptStabilityDecision, number>>>((acc, block) => {
    const decision = block.decision as PromptStabilityDecision;
    acc[decision] = (acc[decision] ?? 0) + 1;
    return acc;
  }, {});
}

function parseSessionLines(raw: string): SessionEnvelope[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionEnvelope);
}

export async function loadSessionReplayData(path: string): Promise<SessionEnvelope[]> {
  return parseSessionLines(await readFile(path, "utf8"));
}

export function replaySession(
  events: SessionEnvelope[],
  options: ReplayOptions = {},
): { turns: ReplayTurn[]; summary: ReplaySummary } {
  const top = options.top ?? 10;
  const transcript: Array<Record<string, unknown>> = [];
  let maintainedTranscript: Array<Record<string, unknown>> = [];
  const turns: ReplayTurn[] = [];
  let previousSent: EnrichedBlock[] | undefined;
  let previousSentSerialized: string | undefined;
  let previousMaintainedSent: EnrichedBlock[] | undefined;
  let previousMaintainedSerialized: string | undefined;
  let sessionId: string | undefined;

  for (const event of events) {
    if (event.type === "session" && typeof event.id === "string") {
      sessionId = event.id;
    }

    if (event.type !== "message" || !event.message) continue;
    const message = event.message;

    if (message.role === "assistant" && message.usage) {
      const normalized = normalizeMessages(transcript);
      const baseline = enrichBlocks(normalized, options.config);
      const baselineFirstDivergence = computeFirstDivergence(previousSent, baseline);
      const baselineSerialized = serializeEnriched(baseline);
      const baselineAppendOnly = isAppendOnly(previousSentSerialized, baselineSerialized);
      const baselinePrefix = prefixChars(baseline, baselineFirstDivergence);

      const maintainedNormalized = normalizeMessages(maintainedTranscript);
      const maintainedBaseline = enrichBlocks(maintainedNormalized, options.config);
      const maintainedPolicy = computePreFrontierInjectionPolicy({
        blocks: maintainedBaseline,
        previousBlocks: previousMaintainedSent,
        config: options.config,
      });
      const maintainedOrdered = applyPreFrontierInjectionPolicy(
        maintainedNormalized,
        maintainedPolicy,
      );
      const maintainedOptimized = enrichBlocks(maintainedOrdered, options.config);
      const maintainedFirstDivergence = computeFirstDivergence(
        previousMaintainedSent,
        maintainedOptimized,
      );
      const maintainedSerialized = serializeEnriched(maintainedOptimized);
      const maintainedAppendOnly = isAppendOnly(previousMaintainedSerialized, maintainedSerialized);
      const maintainedPrefix =
        maintainedPolicy.optimizedPrefixChars ??
        prefixChars(maintainedOptimized, maintainedFirstDivergence);

      const runtimePolicy = computePreFrontierInjectionPolicy({
        blocks: baseline,
        previousBlocks: previousSent,
        config: options.config,
      });
      const optimizedOrdered = applyPreFrontierInjectionPolicy(normalized, runtimePolicy);
      const optimized = enrichBlocks(optimizedOrdered, options.config);
      const optimizedFirstDivergence = computeFirstDivergence(previousSent, optimized);
      const optimizedSerialized = serializeEnriched(optimized);
      const optimizedAppendOnly = isAppendOnly(previousSentSerialized, optimizedSerialized);
      const optimizedPrefix =
        runtimePolicy.optimizedPrefixChars ?? prefixChars(optimized, optimizedFirstDivergence);
      const movement = countMovedBlocks(baseline, optimized);
      const usage = message.usage;
      const currentTurnBenefitPossible =
        previousSentSerialized !== undefined &&
        typeof baselineFirstDivergence?.index === "number" &&
        baselineFirstDivergence.index < (previousSent?.length ?? 0);

      const transcriptWithCurrent = [...transcript, message as Record<string, unknown>];
      const maintenanceWindow = Math.max(
        0,
        transcriptWithCurrent.length - (options.config?.maintainPreserveTailMessages ?? 8),
      );
      let potentialMaintenanceBytesFreed = 0;
      let potentialMaintenanceRewrites = 0;
      for (const priorMessage of transcriptWithCurrent.slice(0, maintenanceWindow)) {
        const candidate = analyzeMaintenanceCandidateForMessage(
          priorMessage as unknown as AgentMessage,
          options.config ?? {},
        );
        if (!candidate) continue;
        const compactedText = buildCompactedText({
          artifactRef: `replay://${sessionId ?? "session"}/${(priorMessage as { id?: string }).id ?? "entry"}`,
          compactedKinds: candidate.compactedKinds,
          bodyText: candidate.bodyText,
        });
        const saved = candidate.originalText.length - compactedText.length;
        const minSaved = options.config?.maintainMinBytesSaved ?? 120;
        if (saved < minSaved) continue;
        potentialMaintenanceBytesFreed += saved;
        potentialMaintenanceRewrites += 1;
      }

      turns.push({
        turnIndex: turns.length,
        assistantMessageId: event.id,
        provider: typeof message.provider === "string" ? message.provider : undefined,
        model: typeof message.model === "string" ? message.model : undefined,
        actualInputTokens: Number(usage.input ?? 0),
        actualOutputTokens: Number(usage.output ?? 0),
        actualCacheReadTokens: Number(usage.cacheRead ?? 0),
        actualCacheReadRatio: ratio(Number(usage.cacheRead ?? 0), Number(usage.input ?? 0)),
        baselineAppendOnly,
        optimizedAppendOnly,
        currentTurnBenefitPossible,
        baselinePrefixChars: baselinePrefix,
        optimizedPrefixChars: optimizedPrefix,
        upliftChars: optimizedPrefix - baselinePrefix,
        maintenanceAdjustedPrefixChars: maintainedPrefix,
        maintenanceAdjustedAppendOnly: maintainedAppendOnly,
        maintenanceUpliftChars: maintainedPrefix - baselinePrefix,
        maintenanceBytesFreedApplied: 0,
        maintenanceRewritesApplied: 0,
        baselineFirstDivergence,
        optimizedFirstDivergence,
        maintenanceAdjustedFirstDivergence: maintainedFirstDivergence,
        movedBlocks: movement.movedBlocks,
        movedStableIds: movement.movedStableIds,
        decisionCounts: countDecisions(
          movement.movedStableIds.map((stableId) => ({ decision: "suffix_ok", stableId })),
        ),
        potentialMaintenanceBytesFreed,
        potentialMaintenanceRewrites,
      });

      previousSent = runtimePolicy.applied ? optimized : baseline;
      previousSentSerialized = runtimePolicy.applied ? optimizedSerialized : baselineSerialized;
      previousMaintainedSent = maintainedPolicy.applied ? maintainedOptimized : maintainedBaseline;
      previousMaintainedSerialized = maintainedPolicy.applied
        ? maintainedSerialized
        : serializeEnriched(maintainedBaseline);
    }

    transcript.push(message as Record<string, unknown>);
    maintainedTranscript.push(message as Record<string, unknown>);

    if (message.role === "assistant") {
      const maintenanceResult = simulateFutureChurnMaintenance({
        messages: maintainedTranscript as unknown as AgentMessage[],
        config: options.config ?? {},
        sessionPartition: sessionId,
      });
      maintainedTranscript = maintenanceResult.messages as unknown as Array<
        Record<string, unknown>
      >;
      const latestTurn = turns.at(-1);
      if (latestTurn) {
        latestTurn.maintenanceBytesFreedApplied = maintenanceResult.bytesFreed;
        latestTurn.maintenanceRewritesApplied = maintenanceResult.rewrittenEntries;
      }
    }
  }

  const totalActualInputTokens = turns.reduce((sum, turn) => sum + turn.actualInputTokens, 0);
  const totalActualCacheReadTokens = turns.reduce(
    (sum, turn) => sum + turn.actualCacheReadTokens,
    0,
  );
  const totalBaselinePrefixChars = turns.reduce((sum, turn) => sum + turn.baselinePrefixChars, 0);
  const totalOptimizedPrefixChars = turns.reduce((sum, turn) => sum + turn.optimizedPrefixChars, 0);
  const totalUpliftChars = turns.reduce((sum, turn) => sum + turn.upliftChars, 0);
  const turnsWithPositiveUplift = turns.filter((turn) => turn.upliftChars > 0).length;
  const totalMaintenanceAdjustedPrefixChars = turns.reduce(
    (sum, turn) => sum + turn.maintenanceAdjustedPrefixChars,
    0,
  );
  const totalMaintenanceUpliftChars = turns.reduce(
    (sum, turn) => sum + turn.maintenanceUpliftChars,
    0,
  );
  const turnsWithPositiveMaintenanceUplift = turns.filter(
    (turn) => turn.maintenanceUpliftChars > 0,
  ).length;
  const maintenanceAdjustedAppendOnlyTurns = turns.filter(
    (turn) => turn.maintenanceAdjustedAppendOnly,
  ).length;
  const totalAppliedMaintenanceBytesFreed = turns.reduce(
    (sum, turn) => sum + turn.maintenanceBytesFreedApplied,
    0,
  );
  const totalAppliedMaintenanceRewrites = turns.reduce(
    (sum, turn) => sum + turn.maintenanceRewritesApplied,
    0,
  );
  const baselineAppendOnlyTurns = turns.filter((turn) => turn.baselineAppendOnly).length;
  const optimizedAppendOnlyTurns = turns.filter((turn) => turn.optimizedAppendOnly).length;
  const turnsWhereCurrentTurnReorderCannotHelp = turns.filter(
    (turn) => !turn.currentTurnBenefitPossible,
  ).length;
  const turnsWithPotentialCurrentTurnBenefit = turns.filter(
    (turn) => turn.currentTurnBenefitPossible,
  ).length;
  const totalPotentialMaintenanceBytesFreed = turns.reduce(
    (sum, turn) => sum + turn.potentialMaintenanceBytesFreed,
    0,
  );
  const totalPotentialMaintenanceRewrites = turns.reduce(
    (sum, turn) => sum + turn.potentialMaintenanceRewrites,
    0,
  );
  const turnsWithPotentialMaintenanceBenefit = turns.filter(
    (turn) => turn.potentialMaintenanceBytesFreed > 0,
  ).length;

  const summary: ReplaySummary = {
    sessionId,
    totalTurns: turns.length,
    turnsWithActualUsage: turns.filter((turn) => turn.actualInputTokens > 0).length,
    totalActualInputTokens,
    totalActualCacheReadTokens,
    actualCacheReadRatio: ratio(totalActualCacheReadTokens, totalActualInputTokens),
    totalBaselinePrefixChars,
    totalOptimizedPrefixChars,
    totalUpliftChars,
    averageBaselinePrefixChars: turns.length
      ? Math.round(totalBaselinePrefixChars / turns.length)
      : 0,
    averageOptimizedPrefixChars: turns.length
      ? Math.round(totalOptimizedPrefixChars / turns.length)
      : 0,
    averageUpliftChars: turns.length ? Math.round(totalUpliftChars / turns.length) : 0,
    turnsWithPositiveUplift,
    totalMaintenanceAdjustedPrefixChars,
    averageMaintenanceAdjustedPrefixChars: turns.length
      ? Math.round(totalMaintenanceAdjustedPrefixChars / turns.length)
      : 0,
    totalMaintenanceUpliftChars,
    averageMaintenanceUpliftChars: turns.length
      ? Math.round(totalMaintenanceUpliftChars / turns.length)
      : 0,
    turnsWithPositiveMaintenanceUplift,
    maintenanceAdjustedAppendOnlyTurns,
    totalAppliedMaintenanceBytesFreed,
    totalAppliedMaintenanceRewrites,
    baselineAppendOnlyTurns,
    optimizedAppendOnlyTurns,
    turnsWhereCurrentTurnReorderCannotHelp,
    turnsWithPotentialCurrentTurnBenefit,
    totalPotentialMaintenanceBytesFreed,
    totalPotentialMaintenanceRewrites,
    turnsWithPotentialMaintenanceBenefit,
    topTurnsByUplift: [...turns]
      .sort(
        (left, right) => right.upliftChars - left.upliftChars || left.turnIndex - right.turnIndex,
      )
      .slice(0, top),
  };

  return { turns, summary };
}
