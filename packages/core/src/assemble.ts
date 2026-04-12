import { canonicalizeBlock } from "./canonicalize.js";
import type {
  AssemblyPlan,
  CanonicalizedBlock,
  CorePolicyConfig,
  NormalizedBlock,
  PromptStabilityBlockKind,
} from "./types.js";

function shouldDedupe(
  previous: CanonicalizedBlock | undefined,
  current: CanonicalizedBlock,
): boolean {
  if (!previous) return false;
  const dedupeKinds: PromptStabilityBlockKind[] = [
    "system_reminder",
    "async_exec_notice",
    "queued_messages",
  ];
  return dedupeKinds.includes(current.kind) && previous.hash === current.hash;
}

export function buildAssemblyPlan(
  blocks: NormalizedBlock[],
  cfg: CorePolicyConfig = {},
): AssemblyPlan {
  const planned: CanonicalizedBlock[] = [];
  const counts: Partial<Record<PromptStabilityBlockKind, number>> = {};

  for (const block of blocks) {
    const canonicalized = canonicalizeBlock(block, cfg);
    counts[canonicalized.kind] = (counts[canonicalized.kind] ?? 0) + 1;
    if (cfg.dedupeControlMessages && shouldDedupe(planned.at(-1), canonicalized)) continue;
    planned.push(canonicalized);
  }

  return {
    blocks: planned,
    estimatedChars: planned.reduce((sum, block) => sum + block.canonicalText.length, 0),
    blockCounts: counts,
  };
}
