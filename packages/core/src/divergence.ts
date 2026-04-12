import type { CanonicalizedBlock, FirstDivergence } from "./types.js";

export function computeFirstDivergence(
  previous: CanonicalizedBlock[] | undefined,
  current: CanonicalizedBlock[],
): FirstDivergence | undefined {
  if (!previous) return undefined;
  const max = Math.max(previous.length, current.length);
  for (let index = 0; index < max; index += 1) {
    const prev = previous[index];
    const next = current[index];
    if (!prev || !next || prev.hash !== next.hash) {
      return {
        index,
        previousHash: prev?.hash,
        currentHash: next?.hash,
      };
    }
  }
  return undefined;
}
