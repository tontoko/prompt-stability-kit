import type { BlockSliceability, PromptStabilityBlockKind } from "./types.js";

const PRE_FRONTIER_MOVABLE_KINDS = new Set<PromptStabilityBlockKind>([
  "conversation_wrapper",
  "system_reminder",
  "async_exec_notice",
]);

const FUTURE_ONLY_KINDS = new Set<PromptStabilityBlockKind>([
  "internal_runtime_event",
  "queued_messages",
  "compaction_summary",
]);

export function defaultSliceabilityForKind(kind: PromptStabilityBlockKind): BlockSliceability {
  if (PRE_FRONTIER_MOVABLE_KINDS.has(kind)) return "lossless_whole_movable";
  if (FUTURE_ONLY_KINDS.has(kind)) return "future_only";
  return "non_movable";
}

export function isPreFrontierMovableSliceability(
  sliceability: BlockSliceability | undefined,
): boolean {
  return (
    sliceability === "lossless_whole_movable" || sliceability === "lossless_split_child_movable"
  );
}
