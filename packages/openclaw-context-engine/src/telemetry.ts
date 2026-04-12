import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { DiagnosticsSnapshot } from "@tontoko/prompt-stability-core";

export async function writeTelemetry(
  path: string | undefined,
  payload: DiagnosticsSnapshot,
): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}
