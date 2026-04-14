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
              text: [
                "System: [2026-04-10 08:44:46 GMT+9] Slack message in #dev from alice: hello world",
                "",
                'Conversation info (untrusted metadata):\n```json\n{"sender":"alice","channel":"#dev"}\n```',
                "",
                'Sender (untrusted metadata):\n```json\n{"label":"alice","id":"U123"}\n```',
                "",
                "hello world",
              ].join("\n"),
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
              text: [
                "System: [2026-04-10 08:45:46 GMT+9] Slack message in #dev from alice: hello world",
                "",
                'Conversation info (untrusted metadata):\n```json\n{"sender":"alice","message_id":"2","channel":"#dev"}\n```',
                "",
                'Sender (untrusted metadata):\n```json\n{"label":"alice","id":"U123"}\n```',
                "",
                "hello world",
              ].join("\n"),
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

    const replay = replaySession(events, {
      config: {
        maintainPreserveTailMessages: 1,
        maintainMinBytesSaved: 1,
      },
    });

    expect(replay.summary.totalTurns).toBe(2);
    expect(replay.turns[1]?.baselinePrefixChars).toBeGreaterThan(0);
    expect(replay.turns[1]?.optimizedPrefixChars).toBeGreaterThanOrEqual(0);
    expect(replay.turns[1]?.movedBlocks).toBe(0);
    expect(replay.turns[1]?.upliftChars).toBe(0);
    expect(replay.turns[1]?.potentialMaintenanceBytesFreed).toBeGreaterThan(0);
    expect(replay.turns[1]?.potentialMaintenanceRewrites).toBeGreaterThan(0);
    expect(replay.turns[1]?.maintenanceBytesFreedApplied).toBeGreaterThan(0);
    expect(replay.turns[1]?.maintenanceRewritesApplied).toBeGreaterThan(0);
    expect(replay.turns[1]?.maintenanceAdjustedPrefixChars).toBeGreaterThanOrEqual(0);
    expect(replay.summary.baselineAppendOnlyTurns).toBeGreaterThanOrEqual(0);
    expect(replay.summary.maintenanceAdjustedAppendOnlyTurns).toBeGreaterThanOrEqual(0);
    expect(replay.summary.turnsWhereCurrentTurnReorderCannotHelp).toBeGreaterThanOrEqual(0);
    expect(replay.summary.turnsWithPotentialMaintenanceBenefit).toBeGreaterThan(0);
    expect(replay.summary.totalPotentialMaintenanceBytesFreed).toBeGreaterThan(0);
    expect(replay.summary.totalAppliedMaintenanceBytesFreed).toBeGreaterThan(0);
    expect(replay.summary.totalAppliedMaintenanceRewrites).toBeGreaterThan(0);
    expect(replay.summary.totalActualInputTokens).toBe(200);
  });
});
