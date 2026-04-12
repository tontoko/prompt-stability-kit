import type {
  AssembledBlock,
  BlockDecision,
  CorePolicyConfig,
  DecisionRegion,
  DecisionScorecard,
  EnrichedBlock,
  FirstDivergence,
  PromptStabilityBlockKind,
  PromptStabilityDecision,
} from "./types.js";

const DEFAULT_FIXED_PREFIX_KINDS: PromptStabilityBlockKind[] = [
  "system",
  "system_core",
  "tool_inventory",
  "workspace_policy",
];

const DEFAULT_SUFFIX_KINDS: PromptStabilityBlockKind[] = [
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
];

const DEFAULT_SUMMARIZE_KINDS: PromptStabilityBlockKind[] = [
  "tool_result",
  "assistant_turn",
  "internal_runtime_event",
];

const DEFAULT_DROP_KINDS: PromptStabilityBlockKind[] = ["queued_messages", "system_reminder"];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function defaultScorecard(): DecisionScorecard {
  return {
    prefixRequired: 0,
    suffixOk: 0,
    summarizeOk: 0,
    dropOk: 0,
  };
}

function decisionRegion(decision: PromptStabilityDecision, locked: boolean): DecisionRegion {
  if (decision === "drop_ok") return "dropped";
  if (decision === "summarize_ok") return "summary_candidate";
  if (decision === "suffix_ok") return "suffix";
  return locked ? "fixed_prefix" : "working_prefix";
}

function normalizeWeights(config: CorePolicyConfig) {
  return {
    volatility: config.heuristicWeights?.volatility ?? 0.55,
    prefixValue: config.heuristicWeights?.prefixValue ?? 0.55,
    divergence: config.heuristicWeights?.divergence ?? 0.2,
    size: config.heuristicWeights?.size ?? 0.15,
  };
}

function maxIndexFromBoundary(blocks: EnrichedBlock[], config: CorePolicyConfig): number {
  if ((config.fixedPrefixBoundaryMode ?? "leading-fixed-run") === "none") return -1;
  const fixedKinds = new Set(config.fixedPrefixKinds ?? DEFAULT_FIXED_PREFIX_KINDS);
  const fixedIds = new Set(config.fixedPrefixIds ?? []);

  let boundary = -1;
  for (const block of blocks) {
    const fixed =
      block.positionConstraint === "fixed_prefix" ||
      fixedIds.has(block.id) ||
      fixedIds.has(block.stableId) ||
      fixedKinds.has(block.kind);
    if (!fixed) break;
    boundary = block.originalIndex;
  }
  return boundary;
}

function hardConstraintDecision(params: {
  block: EnrichedBlock;
  config: CorePolicyConfig;
  fixedPrefixBoundaryIndex: number;
}): BlockDecision | undefined {
  const { block, config, fixedPrefixBoundaryIndex } = params;
  const fixedKinds = new Set(config.fixedPrefixKinds ?? DEFAULT_FIXED_PREFIX_KINDS);
  const fixedIds = new Set(config.fixedPrefixIds ?? []);
  const dropKinds = new Set(config.dropCandidateKinds ?? DEFAULT_DROP_KINDS);

  const scores = defaultScorecard();

  const fixed =
    block.positionConstraint === "fixed_prefix" ||
    block.originalIndex <= fixedPrefixBoundaryIndex ||
    fixedKinds.has(block.kind) ||
    fixedIds.has(block.id) ||
    fixedIds.has(block.stableId);

  if (fixed) {
    scores.prefixRequired = 1;
    return {
      blockId: block.id,
      stableId: block.stableId,
      decision: "prefix_required",
      confidence: 1,
      locked: true,
      reasons: ["hard-constraint:fixed-prefix"],
      region: "fixed_prefix",
      scores,
    };
  }

  if (
    block.kind === "stable_user" ||
    block.kind === "session_summary" ||
    block.kind === "workspace_policy" ||
    block.kind === "tool_inventory"
  ) {
    scores.prefixRequired = 0.95;
    return {
      blockId: block.id,
      stableId: block.stableId,
      decision: "prefix_required",
      confidence: 0.95,
      locked: false,
      reasons: ["hard-constraint:semantic-prefix-anchor"],
      region: "working_prefix",
      scores,
    };
  }

  if (dropKinds.has(block.kind) && block.text.trim().length === 0) {
    scores.dropOk = 1;
    return {
      blockId: block.id,
      stableId: block.stableId,
      decision: "drop_ok",
      confidence: 1,
      locked: true,
      reasons: ["hard-constraint:empty-drop-candidate"],
      region: "dropped",
      scores,
    };
  }

  return undefined;
}

function heuristicDecision(params: {
  block: EnrichedBlock;
  config: CorePolicyConfig;
  divergence?: FirstDivergence;
}): BlockDecision {
  const { block, config, divergence } = params;
  const weights = normalizeWeights(config);
  const suffixKinds = new Set(config.suffixCandidateKinds ?? DEFAULT_SUFFIX_KINDS);
  const summarizeKinds = new Set(config.summarizeCandidateKinds ?? DEFAULT_SUMMARIZE_KINDS);
  const dropKinds = new Set(config.dropCandidateKinds ?? DEFAULT_DROP_KINDS);
  const minConfidence = config.minConfidenceToReorder ?? 0.2;
  const scores = defaultScorecard();
  const reasons: string[] = [];

  const divergenceBoost =
    divergence && block.originalIndex >= divergence.index && divergence.index >= 0
      ? weights.divergence
      : 0;
  const sizeBoost = block.features.isLarge ? weights.size : 0;

  scores.prefixRequired = clamp(block.features.prefixValueScore * weights.prefixValue);
  scores.suffixOk = clamp(
    block.features.volatilityScore * weights.volatility +
      (suffixKinds.has(block.kind) ? 0.2 : 0) +
      divergenceBoost +
      (block.positionConstraint === "suffix_candidate" ? 0.25 : 0) -
      block.features.prefixValueScore * 0.2,
  );
  scores.summarizeOk = clamp(
    (summarizeKinds.has(block.kind) ? 0.45 : 0) +
      sizeBoost +
      divergenceBoost * 0.4 +
      block.features.volatilityScore * 0.2 -
      block.features.prefixValueScore * 0.1,
  );
  scores.dropOk = clamp(
    (dropKinds.has(block.kind) ? 0.3 : 0) +
      (block.features.isControlLike ? 0.15 : 0) +
      divergenceBoost * 0.35 -
      block.features.prefixValueScore * 0.35 -
      (block.features.charLength > 0 ? 0.05 : 0),
  );

  if (suffixKinds.has(block.kind)) reasons.push("suffix-candidate-kind");
  if (summarizeKinds.has(block.kind) && block.features.isLarge) reasons.push("summarize-large");
  if (dropKinds.has(block.kind)) reasons.push("drop-candidate-kind");
  if (divergence && block.originalIndex >= divergence.index && divergence.index >= 0) {
    reasons.push("after-first-divergence");
  }
  if (block.features.isVolatile) reasons.push("volatile");

  const ranking: Array<[PromptStabilityDecision, number]> = [
    ["prefix_required", scores.prefixRequired],
    ["suffix_ok", scores.suffixOk],
    ["summarize_ok", scores.summarizeOk],
    ["drop_ok", scores.dropOk],
  ];
  ranking.sort((left, right) => right[1] - left[1]);

  const [bestDecision, bestScore] = ranking[0];
  const secondScore = ranking[1]?.[1] ?? 0;
  const confidence = clamp(0.5 + (bestScore - secondScore) / 2);

  const finalDecision =
    bestDecision === "prefix_required" || confidence >= minConfidence
      ? bestDecision
      : "prefix_required";

  if (finalDecision === "prefix_required" && bestDecision !== "prefix_required") {
    reasons.push("confidence-fallback");
  }

  return {
    blockId: block.id,
    stableId: block.stableId,
    decision: finalDecision,
    confidence,
    locked: false,
    reasons: reasons.length > 0 ? reasons : ["heuristic-prefix-required"],
    region: decisionRegion(finalDecision, false),
    scores,
  };
}

export function computeFixedPrefixBoundary(
  blocks: EnrichedBlock[],
  config: CorePolicyConfig = {},
): { index: number; stableIds: string[] } {
  const index = maxIndexFromBoundary(blocks, config);
  return {
    index,
    stableIds:
      index >= 0
        ? blocks.filter((block) => block.originalIndex <= index).map((block) => block.stableId)
        : [],
  };
}

export function decideBlocks(params: {
  blocks: EnrichedBlock[];
  config?: CorePolicyConfig;
  firstDivergence?: FirstDivergence;
}): BlockDecision[] {
  const config = params.config ?? {};
  const fixedPrefixBoundary = computeFixedPrefixBoundary(params.blocks, config);

  return params.blocks.map((block) => {
    const hardDecision = hardConstraintDecision({
      block,
      config,
      fixedPrefixBoundaryIndex: fixedPrefixBoundary.index,
    });
    if (hardDecision) return hardDecision;
    return heuristicDecision({
      block,
      config,
      divergence: params.firstDivergence,
    });
  });
}

export function materializeDecision(params: {
  block: EnrichedBlock;
  decision: BlockDecision;
}): AssembledBlock {
  return {
    ...params.block,
    assembledText: params.block.text,
    hash: params.block.stableHash,
    decision: params.decision.decision,
    confidence: params.decision.confidence,
    region: params.decision.region,
  };
}
