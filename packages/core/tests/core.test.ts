import { describe, expect, it } from "vitest";

import { buildAssemblyPlan, classifyBlock, computeFirstDivergence } from "../src/index.js";
import type { NormalizedBlock } from "../src/types.js";

function block(
  input: Partial<NormalizedBlock> & Pick<NormalizedBlock, "id" | "text">,
): NormalizedBlock {
  return {
    id: input.id,
    text: input.text,
    role: input.role ?? "user",
    originalIndex: input.originalIndex ?? 0,
    kind:
      input.kind ??
      classifyBlock({
        id: input.id,
        text: input.text,
        role: input.role ?? "user",
        originalIndex: input.originalIndex ?? 0,
      }),
  };
}

describe("prompt-stability core", () => {
  it("canonicalizes conversation wrappers", () => {
    const plan = buildAssemblyPlan([
      block({
        id: "1",
        text: "Conversation info (untrusted metadata): x\nMessage body:\nhello world",
      }),
    ]);
    expect(plan.blocks[0].kind).toBe("conversation_wrapper");
    expect(plan.blocks[0].canonicalText).toContain("hello world");
  });

  it("dedupes repeated reminder blocks when enabled", () => {
    const input = [
      block({
        id: "1",
        text: "System: [time] Tasklist reminder\nA scheduled reminder has been triggered.",
      }),
      block({
        id: "2",
        text: "System: [time] Tasklist reminder\nA scheduled reminder has been triggered.",
      }),
    ];
    const plan = buildAssemblyPlan(input, { dedupeControlMessages: true });
    expect(plan.blocks).toHaveLength(1);
  });

  it("detects first divergence from prior block hashes", () => {
    const first = buildAssemblyPlan([block({ id: "1", text: "hello" })]);
    const second = buildAssemblyPlan([block({ id: "1", text: "changed" })]);
    const divergence = computeFirstDivergence(first.blocks, second.blocks);
    expect(divergence?.index).toBe(0);
  });
});
