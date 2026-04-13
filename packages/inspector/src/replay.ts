import { readFile } from "node:fs/promises";
import { normalizeMessages } from "@tontoko/openclaw-stable-prefix-context";
import {
  applyPreFrontierInjectionPolicy,
  type CorePolicyConfig,
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
  baselineFirstDivergence?: FirstDivergence;
  optimizedFirstDivergence?: FirstDivergence;
  movedBlocks: number;
  movedStableIds: string[];
  decisionCounts: Partial<Record<PromptStabilityDecision, number>>;
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
  baselineAppendOnlyTurns: number;
  optimizedAppendOnlyTurns: number;
  turnsWhereCurrentTurnReorderCannotHelp: number;
  turnsWithPotentialCurrentTurnBenefit: number;
  topTurnsByUplift: ReplayTurn[];
};

type ReplayOptions = {
  config?: CorePolicyConfig;
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
  const turns: ReplayTurn[] = [];
  let previousSent: EnrichedBlock[] | undefined;
  let previousSentSerialized: string | undefined;
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
        baselineFirstDivergence,
        optimizedFirstDivergence,
        movedBlocks: movement.movedBlocks,
        movedStableIds: movement.movedStableIds,
        decisionCounts: countDecisions(
          movement.movedStableIds.map((stableId) => ({ decision: "suffix_ok", stableId })),
        ),
      });

      previousSent = runtimePolicy.applied ? optimized : baseline;
      previousSentSerialized = runtimePolicy.applied ? optimizedSerialized : baselineSerialized;
    }

    transcript.push(message as Record<string, unknown>);
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
  const baselineAppendOnlyTurns = turns.filter((turn) => turn.baselineAppendOnly).length;
  const optimizedAppendOnlyTurns = turns.filter((turn) => turn.optimizedAppendOnly).length;
  const turnsWhereCurrentTurnReorderCannotHelp = turns.filter(
    (turn) => !turn.currentTurnBenefitPossible,
  ).length;
  const turnsWithPotentialCurrentTurnBenefit = turns.filter(
    (turn) => turn.currentTurnBenefitPossible,
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
    baselineAppendOnlyTurns,
    optimizedAppendOnlyTurns,
    turnsWhereCurrentTurnReorderCannotHelp,
    turnsWithPotentialCurrentTurnBenefit,
    topTurnsByUplift: [...turns]
      .sort(
        (left, right) => right.upliftChars - left.upliftChars || left.turnIndex - right.turnIndex,
      )
      .slice(0, top),
  };

  return { turns, summary };
}
