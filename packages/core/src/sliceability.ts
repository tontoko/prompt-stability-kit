import type { BlockSliceability, CorePolicyConfig, PromptStabilityBlockKind } from "./types.js";

const DEFAULT_LOSSLESS_WHOLE_MOVABLE_KINDS = new Set<PromptStabilityBlockKind>([
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
]);

const DEFAULT_FUTURE_ONLY_KINDS = new Set<PromptStabilityBlockKind>([
  "queued_messages",
  "compaction_summary",
]);

function resolveKindSet(
  overrideKinds: PromptStabilityBlockKind[] | undefined,
  fallbackKinds: Set<PromptStabilityBlockKind>,
): Set<PromptStabilityBlockKind> {
  return overrideKinds ? new Set<PromptStabilityBlockKind>(overrideKinds) : fallbackKinds;
}

export function defaultSliceabilityForKind(
  kind: PromptStabilityBlockKind,
  config: CorePolicyConfig = {},
): BlockSliceability {
  const losslessWholeMovableKinds = resolveKindSet(
    config.losslessWholeMovableKinds,
    DEFAULT_LOSSLESS_WHOLE_MOVABLE_KINDS,
  );
  const futureOnlyKinds = resolveKindSet(config.futureOnlyKinds, DEFAULT_FUTURE_ONLY_KINDS);
  if (losslessWholeMovableKinds.has(kind)) return "lossless_whole_movable";
  if (futureOnlyKinds.has(kind)) return "future_only";
  return "non_movable";
}

export function isPreFrontierMovableSliceability(
  sliceability: BlockSliceability | undefined,
): boolean {
  return (
    sliceability === "lossless_whole_movable" || sliceability === "lossless_split_child_movable"
  );
}
