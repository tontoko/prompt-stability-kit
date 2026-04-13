import { defaultSliceabilityForKind } from "./sliceability.js";
import type { BlockFeatures, CorePolicyConfig, EnrichedBlock, NormalizedBlock } from "./types.js";

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/u).length;
}

const VOLATILE_KINDS = new Set([
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
]);

const CONTROL_KINDS = new Set([
  "system",
  "system_core",
  "tool_inventory",
  "workspace_policy",
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
]);

function computeVolatilityScore(block: NormalizedBlock, largeBlockChars: number): number {
  let score = 0;
  if (VOLATILE_KINDS.has(block.kind)) score += 0.65;
  if (block.kind === "tool_result") score += 0.45;
  if (block.kind === "assistant_turn") score += 0.18;
  if (block.kind === "stable_user") score += 0.08;
  if (block.positionConstraint === "suffix_candidate") score += 0.25;
  if (block.positionConstraint === "fixed_prefix") score -= 0.35;
  if (block.text.length >= largeBlockChars) score += 0.12;
  return clamp(score);
}

function computePrefixValueScore(block: NormalizedBlock): number {
  let score = 0.15;
  if (block.role === "system") score += 0.4;
  if (block.kind === "stable_user") score += 0.45;
  if (block.kind === "system_core" || block.kind === "workspace_policy") score += 0.55;
  if (block.kind === "tool_inventory") score += 0.5;
  if (block.kind === "session_summary") score += 0.35;
  if (block.kind === "assistant_turn") score += 0.18;
  if (block.kind === "tool_result") score -= 0.08;
  if (VOLATILE_KINDS.has(block.kind)) score -= 0.25;
  if (block.positionConstraint === "fixed_prefix") score += 0.5;
  if (block.positionConstraint === "suffix_candidate") score -= 0.2;
  return clamp(score);
}

export function buildBlockFeatures(
  block: NormalizedBlock,
  config: CorePolicyConfig = {},
): BlockFeatures {
  const largeBlockChars = config.largeBlockChars ?? 1200;
  const charLength = block.text.length;
  const volatilityScore = computeVolatilityScore(block, largeBlockChars);
  const prefixValueScore = computePrefixValueScore(block);

  return {
    charLength,
    lineCount: countLines(block.text),
    estimatedTokens: estimateTokens(block.text),
    isControlLike: CONTROL_KINDS.has(block.kind),
    isVolatile: volatilityScore >= 0.5,
    isLarge: charLength >= largeBlockChars,
    volatilityScore,
    prefixValueScore,
  };
}

export function enrichBlock(
  block: NormalizedBlock,
  hashes: { stableHash: string; semanticHash: string },
  config: CorePolicyConfig = {},
): EnrichedBlock {
  return {
    ...block,
    stableId: block.stableId ?? block.id,
    stableHash: hashes.stableHash,
    semanticHash: hashes.semanticHash,
    sliceability: block.sliceability ?? defaultSliceabilityForKind(block.kind, config),
    features: buildBlockFeatures(block, config),
  };
}
