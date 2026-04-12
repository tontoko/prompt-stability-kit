import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { DiagnosticsSnapshot } from "@tontoko/prompt-stability-core";

export async function writeTelemetry(
  path: string | undefined,
  payload: DiagnosticsSnapshot,
): Promise<void> {
  if (!path) return;
  const resolvedPath =
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  await mkdir(dirname(resolvedPath), { recursive: true });
  await appendFile(resolvedPath, `${JSON.stringify(payload)}\n`, "utf8");
}
