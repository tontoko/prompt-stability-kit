import { computeFirstDivergence } from "./divergence.js";
import { isPreFrontierMovableSliceability } from "./sliceability.js";
import type { EnrichedBlock, RuntimePolicyPlan } from "./types.js";

const DEFAULT_PRE_FRONTIER_INJECTED_KINDS = new Set([
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
]);

function isInjectedVolatilityKind(kind: string, kinds: Set<string>): boolean {
  return kinds.has(kind);
}

function isMovableInjectedBlock(block: EnrichedBlock, kinds: Set<string>): boolean {
  return (
    isPreFrontierMovableSliceability(block.sliceability) &&
    (block.positionConstraint === "suffix_candidate" || isInjectedVolatilityKind(block.kind, kinds))
  );
}

function moveWindowToSuffix<T>(blocks: T[], start: number, end: number): T[] {
  return [...blocks.slice(0, start), ...blocks.slice(end + 1), ...blocks.slice(start, end + 1)];
}

export function computePreFrontierInjectionPolicy(params: {
  blocks: EnrichedBlock[];
  previousBlocks?: Array<Pick<EnrichedBlock, "stableId" | "stableHash" | "kind">>;
  config?: {
    runtimePolicyMode?: "pre-frontier-injected-only" | "off";
    preFrontierInjectedKinds?: string[];
    preFrontierInjectedWindowBlocks?: number;
  };
}): RuntimePolicyPlan {
  const config = params.config ?? {};
  if (config.runtimePolicyMode === "off") {
    return { applied: false, reason: "runtime-policy-disabled", movedStableIds: [] };
  }

  const previousBlocks = params.previousBlocks;
  if (!previousBlocks || previousBlocks.length === 0) {
    return { applied: false, reason: "missing-previous-prefix", movedStableIds: [] };
  }

  const firstDivergence = computeFirstDivergence(previousBlocks, params.blocks);
  if (!firstDivergence) {
    return { applied: false, reason: "no-divergence", movedStableIds: [] };
  }

  if (firstDivergence.index >= previousBlocks.length) {
    return { applied: false, reason: "append-only-growth", firstDivergence, movedStableIds: [] };
  }

  const injectedKinds = new Set<string>(
    config.preFrontierInjectedKinds ?? [...DEFAULT_PRE_FRONTIER_INJECTED_KINDS],
  );
  const start = firstDivergence.index;
  const startBlock = params.blocks[start];
  if (!startBlock || !isMovableInjectedBlock(startBlock, injectedKinds)) {
    return {
      applied: false,
      reason: "divergence-not-pre-frontier-injected-volatility",
      firstDivergence,
      movedStableIds: [],
    };
  }

  const maxWindowBlocks = config.preFrontierInjectedWindowBlocks ?? 3;
  let end = start;
  while (
    end + 1 < params.blocks.length &&
    end - start + 1 < maxWindowBlocks &&
    isMovableInjectedBlock(params.blocks[end + 1] as EnrichedBlock, injectedKinds)
  ) {
    end += 1;
  }

  if (end >= params.blocks.length - 1) {
    return {
      applied: false,
      reason: "no-stable-suffix-after-injected-window",
      firstDivergence,
      movedStableIds: [],
    };
  }

  const baselinePrefixChars = prefixChars(params.blocks, firstDivergence);
  const reordered = moveWindowToSuffix(params.blocks, start, end);
  const optimizedFirstDivergence = computeFirstDivergence(previousBlocks, reordered);
  const optimizedPrefixChars = prefixChars(reordered, optimizedFirstDivergence);
  const upliftChars = optimizedPrefixChars - baselinePrefixChars;
  if (upliftChars <= 0) {
    return {
      applied: false,
      reason: "predicted-no-uplift",
      firstDivergence,
      movedStableIds: [],
      baselinePrefixChars,
      optimizedPrefixChars,
      upliftChars,
    };
  }

  const movedStableIds = params.blocks.slice(start, end + 1).map((block) => block.stableId);
  return {
    applied: true,
    reason: "pre-frontier-injected-window",
    firstDivergence,
    moveStartIndex: start,
    moveEndIndex: end,
    movedStableIds,
    baselinePrefixChars,
    optimizedPrefixChars,
    upliftChars,
  };
}

export function applyPreFrontierInjectionPolicy<T>(blocks: T[], policy: RuntimePolicyPlan): T[] {
  if (!policy.applied || policy.moveStartIndex === undefined || policy.moveEndIndex === undefined) {
    return blocks;
  }
  return moveWindowToSuffix(blocks, policy.moveStartIndex, policy.moveEndIndex);
}

function prefixChars(
  blocks: Array<{ text: string }>,
  firstDivergence: { index: number } | undefined,
): number {
  const boundary = firstDivergence?.index ?? blocks.length;
  return blocks.slice(0, boundary).reduce((sum, block) => sum + block.text.length, 0);
}
