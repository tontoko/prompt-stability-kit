import { buildOptimizationPlan } from "@tontoko/prompt-stability-core";
import { describe, expect, it } from "vitest";

import { assembledBlocksToMessages } from "../src/convert.js";
import { normalizeMessages } from "../src/normalize.js";

describe("openclaw adapter normalization", () => {
  it("splits sender metadata wrappers into suffix metadata and prefix body blocks", () => {
    const blocks = normalizeMessages([
      {
        id: "msg-1",
        role: "user",
        content:
          'Sender (untrusted metadata):\n```json\n{"label":"cli","id":"cli"}\n```\n\n[Sun 2026-04-12 22:54 GMT+9] Reply with exactly: smoke-ok',
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("conversation_wrapper");
    expect(blocks[0]?.positionConstraint).toBe("suffix_candidate");
    expect(blocks[0]?.sliceability).toBe("lossless_split_child_movable");
    expect(blocks[1]?.kind).toBe("stable_user");
    expect(blocks[1]?.positionConstraint).toBe("prefix_candidate");
    expect(blocks[1]?.sliceability).toBe("non_movable");
    expect(blocks[1]?.text).toContain("Reply with exactly: smoke-ok");
  });

  it("reorders split wrapper blocks without mutating assistant structured content", () => {
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "text", text: "Plan:" },
        {
          type: "toolCall",
          id: "functions.exec:0",
          name: "exec",
          arguments: { command: "echo hello" },
        },
      ],
    };

    const blocks = normalizeMessages([
      {
        id: "msg-1",
        role: "user",
        content:
          'Conversation info (untrusted metadata):\n```json\n{"sender":"alice"}\n```\nMessage body:\nPlease continue the task.',
      },
      assistantMessage,
    ]);

    const plan = buildOptimizationPlan({ blocks });
    const messages = assembledBlocksToMessages(plan.blocks);

    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toBe("Please continue the task.");
    expect(messages.find((message) => message.id === "assistant-1")).toEqual(assistantMessage);
    expect(
      messages.find(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Conversation info (untrusted metadata):"),
      )?.content,
    ).toContain("Conversation info (untrusted metadata):");
  });

  it("detects conversation wrappers inside text-only content arrays from real session shapes", () => {
    const blocks = normalizeMessages([
      {
        id: "msg-real",
        role: "user",
        content: [
          {
            type: "text",
            text: 'Conversation info (untrusted metadata):\n```json\n{"conversation_label":"#dev"}\n```\n\nSender (untrusted metadata):\n```json\n{"label":"alice"}\n```\n\nhello from discord',
          },
        ],
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("conversation_wrapper");
    expect(blocks[1]?.kind).toBe("stable_user");
    const rebuilt = blocks.flatMap((block) => block.toMessages());
    expect(Array.isArray(rebuilt[0]?.content)).toBe(true);
    expect(JSON.stringify(rebuilt[1]?.content)).toContain("hello from discord");
  });
});
