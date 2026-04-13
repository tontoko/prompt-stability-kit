import { describe, expect, it } from "vitest";

import { defaultSliceabilityForKind, isPreFrontierMovableSliceability } from "../src/index.js";

describe("sliceability matrix", () => {
  it("marks only safe injected wrappers as pre-frontier movable by default", () => {
    expect(defaultSliceabilityForKind("conversation_wrapper")).toBe("lossless_whole_movable");
    expect(defaultSliceabilityForKind("system_reminder")).toBe("lossless_whole_movable");
    expect(defaultSliceabilityForKind("async_exec_notice")).toBe("lossless_whole_movable");
    expect(defaultSliceabilityForKind("internal_runtime_event")).toBe("future_only");
    expect(defaultSliceabilityForKind("queued_messages")).toBe("future_only");
    expect(defaultSliceabilityForKind("stable_user")).toBe("non_movable");
  });

  it("treats split child slices as movable and future-only blocks as non-movable", () => {
    expect(isPreFrontierMovableSliceability("lossless_split_child_movable")).toBe(true);
    expect(isPreFrontierMovableSliceability("lossless_whole_movable")).toBe(true);
    expect(isPreFrontierMovableSliceability("future_only")).toBe(false);
    expect(isPreFrontierMovableSliceability("non_movable")).toBe(false);
  });
});
