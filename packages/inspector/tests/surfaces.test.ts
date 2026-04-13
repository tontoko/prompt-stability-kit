import { describe, expect, it } from "vitest";

import { analyzeSessionSurfaces, summarizeSurfaceCorpus } from "../src/surfaces.js";

const session = [
  { type: "session", id: "session-1" },
  {
    type: "message",
    id: "user-1",
    message: {
      role: "user",
      content:
        'Conversation info (untrusted metadata):\n```json\n{"channel":"#dev"}\n```\nMessage body:\nPlease continue.',
    },
  },
  {
    type: "message",
    id: "assistant-1",
    message: {
      role: "assistant",
      content: "Acknowledged.",
      usage: { input: 10, output: 2, cacheRead: 8 },
    },
  },
] as const;

describe("surface analysis", () => {
  it("summarizes normalized block kinds and movable chars", () => {
    const summary = analyzeSessionSurfaces([...session]);

    expect(summary.sessionId).toBe("session-1");
    expect(summary.totalMessages).toBe(2);
    expect(summary.totalBlocks).toBe(3);
    expect(summary.totalMovableChars).toBeGreaterThan(0);
    expect(summary.totalPreFrontierInjectedChars).toBeGreaterThan(0);
    expect(summary.kindsByChars.map((entry) => entry.kind)).toContain("conversation_wrapper");
    expect(summary.kindsByChars.map((entry) => entry.kind)).toContain("stable_user");
  });

  it("aggregates multiple sessions into a corpus summary", () => {
    const corpus = summarizeSurfaceCorpus([
      { path: "a.jsonl", events: [...session] },
      { path: "b.jsonl", events: [...session] },
    ]);

    expect(corpus.sessions).toBe(2);
    expect(corpus.totalMessages).toBe(4);
    expect(corpus.totalBlocks).toBe(6);
    expect(corpus.totalPreFrontierInjectedChars).toBeGreaterThan(0);
    expect(corpus.kindsByChars[0]?.count).toBeGreaterThan(0);
  });
});
