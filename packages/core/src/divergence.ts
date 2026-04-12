import type { AssembledBlock, EnrichedBlock, FirstDivergence } from "./types.js";

type DivergenceComparable =
  | Pick<AssembledBlock, "hash" | "kind" | "stableId">
  | Pick<EnrichedBlock, "kind" | "stableHash" | "stableId">;

function readHash(block: DivergenceComparable | undefined): string | undefined {
  if (!block) return undefined;
  return "hash" in block ? block.hash : block.stableHash;
}

export function computeFirstDivergence(
  previous: DivergenceComparable[] | undefined,
  current: DivergenceComparable[],
): FirstDivergence | undefined {
  if (!previous) return undefined;
  const max = Math.max(previous.length, current.length);
  for (let index = 0; index < max; index += 1) {
    const prev = previous[index];
    const next = current[index];
    const previousHash = readHash(prev);
    const currentHash = readHash(next);
    if (!prev || !next || previousHash !== currentHash) {
      return {
        index,
        previousKind: prev?.kind,
        currentKind: next?.kind,
        previousHash,
        currentHash,
        previousStableId: prev?.stableId,
        currentStableId: next?.stableId,
      };
    }
  }
  return undefined;
}
