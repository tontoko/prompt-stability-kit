import { describe, expect, it } from "vitest";

import { replaySession } from "../src/replay.js";

describe("session replay evaluator", () => {
  it("computes baseline vs optimized prefix uplift from session-like events", () => {
    const events = [
      { type: "session", id: "demo" },
      {
        type: "message",
        id: "user-1",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Conversation info (untrusted metadata):\n```json\n{"sender":"alice"}\n```\n\nMessage body:\nhello world',
            },
          ],
        },
      },
      {
        type: "message",
        id: "assistant-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ack" }],
          provider: "fireworks",
          model: "kimi",
          usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110 },
        },
      },
      {
        type: "message",
        id: "user-2",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Conversation info (untrusted metadata):\n```json\n{"sender":"alice","message_id":"2"}\n```\n\nMessage body:\nhello world',
            },
          ],
        },
      },
      {
        type: "message",
        id: "assistant-2",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ack-2" }],
          provider: "fireworks",
          model: "kimi",
          usage: { input: 100, output: 10, cacheRead: 80, cacheWrite: 0, totalTokens: 190 },
        },
      },
    ];

    const replay = replaySession(events);

    expect(replay.summary.totalTurns).toBe(2);
    expect(replay.turns[1]?.baselinePrefixChars).toBeGreaterThan(0);
    expect(replay.turns[1]?.optimizedPrefixChars).toBeGreaterThanOrEqual(0);
    expect(replay.turns[1]?.movedBlocks).toBe(0);
    expect(replay.turns[1]?.upliftChars).toBe(0);
    expect(replay.summary.baselineAppendOnlyTurns).toBeGreaterThanOrEqual(0);
    expect(replay.summary.turnsWhereCurrentTurnReorderCannotHelp).toBeGreaterThanOrEqual(0);
    expect(replay.summary.totalActualInputTokens).toBe(200);
  });
});
