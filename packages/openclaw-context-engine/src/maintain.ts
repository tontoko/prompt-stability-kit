import { readFile } from "node:fs/promises";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { canonicalizeBlock } from "@tontoko/prompt-stability-core";

import { normalizeMessages } from "./normalize.js";

type TranscriptLine = {
  type?: string;
  id?: string;
  message?: Record<string, unknown>;
};

type Replacement = {
  entryId: string;
  message: AgentMessage;
};

function toTextParts(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

function buildReplacementMessage(
  original: Record<string, unknown>,
  canonicalText: string,
): AgentMessage {
  const next = { ...original };
  if (Array.isArray(original.content)) {
    next.content = toTextParts(canonicalText);
  } else {
    next.content = canonicalText;
  }
  return next as unknown as AgentMessage;
}

function shouldRewrite(kind: string): boolean {
  return [
    "conversation_wrapper",
    "internal_runtime_event",
    "system_reminder",
    "async_exec_notice",
    "queued_messages",
  ].includes(kind);
}

export async function collectTranscriptRewrites(params: {
  sessionFile: string;
  maxRewrites?: number;
  preserveTailMessages?: number;
  policy: {
    maxConversationWrapperBodyChars?: number;
    maxInternalContextChars?: number;
  };
}): Promise<Replacement[]> {
  const raw = await readFile(params.sessionFile, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TranscriptLine);
  const messageLines = lines.filter(
    (line): line is TranscriptLine & { id: string; message: Record<string, unknown> } =>
      line.type === "message" && typeof line.id === "string" && !!line.message,
  );
  const cutoff = Math.max(messageLines.length - (params.preserveTailMessages ?? 4), 0);
  const candidates = messageLines.slice(0, cutoff);
  const normalized = normalizeMessages(candidates.map((line) => line.message));

  const replacements: Replacement[] = [];
  for (const [index, block] of normalized.entries()) {
    if (!shouldRewrite(block.kind)) continue;
    const canonical = canonicalizeBlock(block, params.policy);
    if (canonical.canonicalText === block.text) continue;
    const line = candidates[index];
    replacements.push({
      entryId: line.id,
      message: buildReplacementMessage(line.message, canonical.canonicalText),
    });
    if (replacements.length >= (params.maxRewrites ?? 12)) break;
  }

  return replacements;
}
