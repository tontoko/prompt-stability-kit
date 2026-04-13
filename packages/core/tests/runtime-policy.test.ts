import { describe, expect, it } from "vitest";

import {
  applyPreFrontierInjectionPolicy,
  computePreFrontierInjectionPolicy,
  enrichBlocks,
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
    sliceability: input.sliceability,
    metadata: input.metadata,
  };
  return {
    ...base,
    kind: input.kind ?? "other",
  };
}

describe("pre-frontier runtime policy", () => {
  it("no-ops on append-only growth", () => {
    const previous = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({ id: "user", originalIndex: 1, text: "hello", kind: "stable_user" }),
      ],
      {},
    );
    const current = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({ id: "user", originalIndex: 1, text: "hello", kind: "stable_user" }),
        block({
          id: "wrapper",
          originalIndex: 2,
          text: "Conversation info (untrusted metadata):\nMessage body:\nnew tail",
          kind: "conversation_wrapper",
          positionConstraint: "suffix_candidate",
        }),
      ],
      {},
    );

    const policy = computePreFrontierInjectionPolicy({
      blocks: current,
      previousBlocks: previous.map((block) => ({
        stableId: block.stableId,
        stableHash: block.stableHash,
        kind: block.kind,
      })),
      config: {},
    });

    expect(policy.applied).toBe(false);
    expect(policy.reason).toBe("append-only-growth");
    expect(applyPreFrontierInjectionPolicy(current, policy)).toEqual(current);
  });

  it("moves only pre-frontier injected volatility ahead of stable suffix", () => {
    const previous = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({ id: "user", originalIndex: 1, text: "hello", kind: "stable_user" }),
        block({
          id: "assistant",
          role: "assistant",
          originalIndex: 2,
          text: "ack",
          kind: "assistant_turn",
        }),
      ],
      {},
    );
    const current = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({
          id: "wrapper",
          originalIndex: 1,
          text: "Conversation info (untrusted metadata):\nMessage body:\nvolatile",
          kind: "conversation_wrapper",
          positionConstraint: "suffix_candidate",
        }),
        block({ id: "user", originalIndex: 2, text: "hello", kind: "stable_user" }),
        block({
          id: "assistant",
          role: "assistant",
          originalIndex: 3,
          text: "ack",
          kind: "assistant_turn",
        }),
      ],
      {},
    );

    const policy = computePreFrontierInjectionPolicy({
      blocks: current,
      previousBlocks: previous.map((block) => ({
        stableId: block.stableId,
        stableHash: block.stableHash,
        kind: block.kind,
      })),
      config: { preFrontierInjectedWindowBlocks: 2 },
    });

    const reordered = applyPreFrontierInjectionPolicy(current, policy);

    expect(policy.applied).toBe(true);
    expect(policy.reason).toBe("pre-frontier-injected-window");
    expect(policy.movedStableIds).toEqual(["wrapper"]);
    expect(reordered.map((block) => block.id)).toEqual(["system", "user", "assistant", "wrapper"]);
  });

  it("moves internal runtime events when they are the only pre-frontier divergence", () => {
    const previous = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({ id: "user", originalIndex: 1, text: "hello", kind: "stable_user" }),
      ],
      {},
    );
    const current = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({
          id: "internal",
          originalIndex: 1,
          text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nchild done\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
          kind: "internal_runtime_event",
          positionConstraint: "suffix_candidate",
        }),
        block({ id: "user", originalIndex: 2, text: "hello", kind: "stable_user" }),
      ],
      {},
    );

    const policy = computePreFrontierInjectionPolicy({
      blocks: current,
      previousBlocks: previous.map((block) => ({
        stableId: block.stableId,
        stableHash: block.stableHash,
        kind: block.kind,
      })),
      config: {},
    });

    const reordered = applyPreFrontierInjectionPolicy(current, policy);

    expect(policy.applied).toBe(true);
    expect(policy.reason).toBe("pre-frontier-injected-window");
    expect(policy.movedStableIds).toEqual(["internal"]);
    expect(reordered.map((block) => block.id)).toEqual(["system", "user", "internal"]);
  });

  it("respects explicit future-only overrides for injected kinds", () => {
    const previous = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({ id: "user", originalIndex: 1, text: "hello", kind: "stable_user" }),
      ],
      {},
    );
    const current = enrichBlocks(
      [
        block({
          id: "system",
          role: "system",
          originalIndex: 0,
          text: "core",
          kind: "system_core",
        }),
        block({
          id: "internal",
          originalIndex: 1,
          text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nchild done\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
          kind: "internal_runtime_event",
          positionConstraint: "suffix_candidate",
          sliceability: "future_only",
        }),
        block({ id: "user", originalIndex: 2, text: "hello", kind: "stable_user" }),
      ],
      {},
    );

    const policy = computePreFrontierInjectionPolicy({
      blocks: current,
      previousBlocks: previous.map((block) => ({
        stableId: block.stableId,
        stableHash: block.stableHash,
        kind: block.kind,
      })),
      config: {},
    });

    expect(policy.applied).toBe(false);
    expect(policy.reason).toBe("divergence-not-pre-frontier-injected-volatility");
  });
});
