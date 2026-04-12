import { describe, expect, it } from "vitest";

import {
  buildAssemblyPlan,
  buildOptimizationPlan,
  classifyBlock,
  computeFirstDivergence,
} from "../src/index.js";
import type { NormalizedBlock } from "../src/types.js";

function block(
  input: Partial<NormalizedBlock> & Pick<NormalizedBlock, "id" | "text">,
): NormalizedBlock {
  const base = {
    id: input.id,
    text: input.text,
    role: input.role ?? "user",
    originalIndex: input.originalIndex ?? 0,
    stableId: input.stableId,
    source: input.source,
    positionConstraint: input.positionConstraint,
    metadata: input.metadata,
  };
  return {
    ...base,
    kind: input.kind ?? classifyBlock(base),
  };
}

describe("prompt-stability core", () => {
  it("detects first divergence using stable hashes and ids", () => {
    const previous = buildAssemblyPlan([
      block({ id: "system", role: "system", originalIndex: 0, text: "core", kind: "system_core" }),
      block({ id: "user", originalIndex: 1, text: "keep me" }),
    ]);
    const current = buildAssemblyPlan([
      block({ id: "system", role: "system", originalIndex: 0, text: "core", kind: "system_core" }),
      block({ id: "user", originalIndex: 1, text: "changed" }),
    ]);

    const divergence = computeFirstDivergence(previous.blocks, current.blocks);
    expect(divergence?.index).toBe(1);
    expect(divergence?.previousStableId).toBe("user");
    expect(divergence?.currentStableId).toBe("user");
  });

  it("keeps fixed prefix blocks in front and pushes volatile wrappers into suffix", () => {
    const plan = buildOptimizationPlan({
      blocks: [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "system core",
          kind: "system_core",
          positionConstraint: "fixed_prefix",
        }),
        block({
          id: "wrapper",
          originalIndex: 1,
          text: "Conversation info (untrusted metadata):\nMessage body:\nhello",
        }),
        block({
          id: "user",
          originalIndex: 2,
          text: "Implement the fix",
          kind: "stable_user",
        }),
      ],
    });

    expect(plan.blocks.map((entry) => entry.id)).toEqual(["system", "user", "wrapper"]);
    expect(plan.prefixBlocks.map((entry) => entry.id)).toEqual(["system", "user"]);
    expect(plan.suffixBlocks.map((entry) => entry.id)).toEqual(["wrapper"]);
    expect(plan.decisions.find((entry) => entry.blockId === "wrapper")?.decision).toBe("suffix_ok");
  });

  it("marks large volatile tool results as summarize candidates without rewriting text", () => {
    const plan = buildOptimizationPlan({
      blocks: [
        block({
          id: "tool",
          role: "tool",
          originalIndex: 0,
          kind: "tool_result",
          text: "log line\n".repeat(400),
        }),
      ],
      config: {
        largeBlockChars: 200,
      },
    });

    expect(plan.summaryCandidates).toHaveLength(1);
    expect(plan.summaryCandidates[0].id).toBe("tool");
    expect(plan.summaryCandidates[0].assembledText).toBe(plan.summaryCandidates[0].text);
    expect(plan.decisions[0].decision).toBe("summarize_ok");
  });
});
