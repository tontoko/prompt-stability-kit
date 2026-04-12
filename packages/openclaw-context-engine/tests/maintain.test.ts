import { describe, expect, it } from "vitest";

import { collectTranscriptRewrites } from "../src/maintain.js";

describe("collectTranscriptRewrites", () => {
  it("finds canonicalizable wrapper-heavy transcript entries", async () => {
    const file = new URL("./fixtures/session.jsonl", import.meta.url);
    const rewrites = await collectTranscriptRewrites({
      sessionFile: file,
      policy: {
        maxConversationWrapperBodyChars: 1600,
        maxInternalContextChars: 800,
      },
      preserveTailMessages: 0,
    });
    expect(rewrites.length).toBeGreaterThan(0);
    expect(rewrites[0]?.entryId).toBe("msg-1");
  });
});
