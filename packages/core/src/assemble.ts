import { decideBlocks, materializeDecision } from "./decision.js";
import { computeFirstDivergence } from "./divergence.js";
import { enrichBlock } from "./features.js";
import { semanticHash, stableHash } from "./hash.js";
import type {
  AssembledBlock,
  AssemblyPlan,
  CorePolicyConfig,
  EnrichedBlock,
  NormalizedBlock,
  OptimizationRequest,
  PromptStabilityBlockKind,
} from "./types.js";

function countKinds(blocks: AssembledBlock[]): Partial<Record<PromptStabilityBlockKind, number>> {
  return blocks.reduce<Partial<Record<PromptStabilityBlockKind, number>>>((acc, block) => {
    acc[block.kind] = (acc[block.kind] ?? 0) + 1;
    return acc;
  }, {});
}

function dedupeConsecutiveControls(blocks: EnrichedBlock[], enabled: boolean): EnrichedBlock[] {
  if (!enabled) return blocks;
  const dedupableKinds = new Set(["system_reminder", "async_exec_notice", "queued_messages"]);
  const deduped: EnrichedBlock[] = [];
  for (const block of blocks) {
    const previous = deduped.at(-1);
    if (
      previous &&
      dedupableKinds.has(block.kind) &&
      previous.kind === block.kind &&
      previous.stableHash === block.stableHash
    ) {
      continue;
    }
    deduped.push(block);
  }
  return deduped;
}

export function enrichBlocks(
  blocks: NormalizedBlock[],
  config: CorePolicyConfig = {},
): EnrichedBlock[] {
  return blocks.map((block) =>
    enrichBlock(
      block,
      {
        stableHash: stableHash(
          JSON.stringify({
            stableId: block.stableId ?? block.id,
            kind: block.kind,
            role: block.role,
            text: block.text,
          }),
        ),
        semanticHash: semanticHash(block.text),
      },
      config,
    ),
  );
}

export function buildOptimizationPlan(request: OptimizationRequest): AssemblyPlan {
  const config = request.config ?? {};
  const enriched = dedupeConsecutiveControls(
    enrichBlocks(request.blocks, config),
    config.dedupeControlMessages ?? false,
  );
  const firstDivergence = computeFirstDivergence(request.previousBlocks, enriched);
  const decisions = decideBlocks({
    blocks: enriched,
    config,
    firstDivergence,
  });
  const materialized = enriched.map((block, index) =>
    materializeDecision({ block, decision: decisions[index] }),
  );

  const fixedPrefixBlocks = materialized
    .filter((block) => block.region === "fixed_prefix")
    .sort((left, right) => left.originalIndex - right.originalIndex);
  const workingPrefixBlocks = materialized
    .filter((block) => block.region === "working_prefix")
    .sort((left, right) => left.originalIndex - right.originalIndex);
  const suffixBlocks = materialized
    .filter((block) => block.region === "suffix" || block.region === "summary_candidate")
    .sort((left, right) => left.originalIndex - right.originalIndex);
  const summaryCandidates = materialized.filter((block) => block.region === "summary_candidate");
  const droppedBlocks = materialized.filter((block) => block.region === "dropped");
  const prefixBlocks = [...fixedPrefixBlocks, ...workingPrefixBlocks];
  const blocks = [...prefixBlocks, ...suffixBlocks];

  let fixedPrefixIndex = -1;
  for (let index = 0; index < prefixBlocks.length; index += 1) {
    if (prefixBlocks[index]?.region === "fixed_prefix") {
      fixedPrefixIndex = index;
    }
  }

  return {
    blocks,
    prefixBlocks,
    suffixBlocks,
    summaryCandidates,
    droppedBlocks,
    decisions,
    estimatedChars: blocks.reduce((sum, block) => sum + block.assembledText.length, 0),
    blockCounts: countKinds(materialized),
    firstDivergence,
    fixedPrefixBoundary: {
      index: fixedPrefixIndex,
      stableIds: prefixBlocks
        .filter((block) => block.region === "fixed_prefix")
        .map((block) => block.stableId),
    },
  };
}

export function buildAssemblyPlan(
  blocks: NormalizedBlock[],
  config: CorePolicyConfig = {},
): AssemblyPlan {
  return buildOptimizationPlan({ blocks, config });
}
