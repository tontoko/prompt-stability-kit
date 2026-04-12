import { describe, expect, it } from "vitest";

import { normalizeMessages } from "../src/normalize.js";

describe("normalizeMessages", () => {
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
    expect(blocks[1]?.kind).toBe("stable_user");
    expect(blocks[1]?.positionConstraint).toBe("prefix_candidate");
    expect(blocks[1]?.text).toContain("Reply with exactly: smoke-ok");
  });
});
