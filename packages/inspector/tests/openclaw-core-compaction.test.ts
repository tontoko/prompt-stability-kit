import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyAllPatches,
  patchSpecs,
  verifyAllPatches,
} from "../../../scripts/lib/openclaw-core-compaction.mjs";

const tempDirs = [];

async function makeFixtureDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "psk-openclaw-core-"));
  tempDirs.push(dir);
  const contents = new Map();
  for (const spec of patchSpecs) {
    const existing = contents.get(spec.file) ?? [];
    existing.push(...spec.replacements.map((replacement) => replacement.from));
    contents.set(spec.file, existing);
  }
  for (const [file, segments] of contents) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), segments.join("\n"), "utf8");
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("openclaw core compaction scripts", () => {
  it("applies all replacements idempotently", async () => {
    const dir = await makeFixtureDir();
    const first = await applyAllPatches(dir);
    const second = await applyAllPatches(dir);

    expect(first.some((result) => result.changed)).toBe(true);
    expect(second.every((result) => result.changed === false)).toBe(true);
  });

  it("verifies patched fixtures and rejects unpatched ones", async () => {
    const dir = await makeFixtureDir();
    const before = await verifyAllPatches(dir);
    expect(before.ok).toBe(false);

    await applyAllPatches(dir);
    const after = await verifyAllPatches(dir);
    expect(after.ok).toBe(true);
    expect(after.results.every((result) => result.passes)).toBe(true);
  });

  it("fails on ambiguous duplicate source matches", async () => {
    const dir = await makeFixtureDir();
    const filePath = path.join(dir, "queue-AttL4x6M.js");
    const original = await readFile(filePath, "utf8");
    await writeFile(filePath, `${original}\n${original}`, "utf8");

    await expect(applyAllPatches(dir)).rejects.toThrow(/Expected exactly one match/);
  });
});
