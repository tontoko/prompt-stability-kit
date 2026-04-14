import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentMessage } from "@mariozechner/pi-agent-core";

import type { PromptStabilityBlockKind } from "@tontoko/prompt-stability-core";

import type { StablePrefixPluginConfig } from "./config.js";
import { normalizeMessages } from "./normalize.js";

const COMPACTED_MARKER = "[Prompt Stability: compacted injected context]";

type SessionEnvelope = {
  type?: string;
  id?: string;
  parentId?: string;
  message?: AgentMessage;
};

type TranscriptEntry = {
  entryId: string;
  parentId?: string;
  message: AnyMessage;
};

type AnyMessage = AgentMessage & {
  id?: string;
  role?: string;
  content?: unknown;
};

type ContextEngineRuntimeContextLike = {
  rewriteTranscriptEntries?: (request: {
    replacements: Array<{ entryId: string; message: AgentMessage }>;
  }) => Promise<{
    changed: boolean;
    bytesFreed: number;
    rewrittenEntries: number;
    reason?: string;
  }>;
};

export type MaintenanceResult = {
  changed: boolean;
  bytesFreed: number;
  rewrittenEntries: number;
  reason: string;
  compactedKinds: Partial<Record<PromptStabilityBlockKind, number>>;
};

export type InMemoryMaintenanceResult = MaintenanceResult & {
  messages: AgentMessage[];
};

export type MaintenanceCandidate = {
  bodyText?: string;
  compactedKinds: PromptStabilityBlockKind[];
  originalText: string;
};

function messageSignature(message: AnyMessage | AgentMessage): string {
  const role = typeof message.role === "string" ? message.role : "";
  const content = "content" in message ? message.content : undefined;
  const text = stringifyTextContent(content).replace(/\s+/g, " ").trim();
  return `${role}\u241f${text}`;
}

const DEFAULT_MAINTAIN_REWRITE_KINDS = new Set<PromptStabilityBlockKind>([
  "inbound_notice",
  "conversation_wrapper",
  "external_untrusted_context",
  "bootstrap_warning",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
]);

function stringifyTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string" &&
        (!("type" in part) ||
          part.type === "text" ||
          part.type === "input_text" ||
          part.type === "output_text")
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildTextContentLike(
  originalContent: unknown,
  text: string,
): string | Array<{ type: "text"; text: string }> {
  if (Array.isArray(originalContent)) {
    return [{ type: "text", text }];
  }
  return text;
}

async function loadTranscriptEntries(sessionFile: string): Promise<TranscriptEntry[]> {
  const raw = await readFile(sessionFile, "utf8");
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionEnvelope);

  return events.flatMap((event) => {
    if (event.type !== "message" || !event.id || !event.message) return [];
    return [{ entryId: event.id, parentId: event.parentId, message: event.message }];
  });
}

export function deriveActiveBranchEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length === 0) return [];

  const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
  const active: TranscriptEntry[] = [];
  let cursor: TranscriptEntry | undefined = entries[entries.length - 1];

  while (cursor) {
    active.unshift(cursor);
    const parentId = cursor.parentId?.trim();
    if (!parentId) break;
    cursor = byId.get(parentId);
  }

  return active;
}

export function matchActiveBranchEntries(
  entries: TranscriptEntry[],
  activeMessages: AgentMessage[],
): TranscriptEntry[] | undefined {
  if (activeMessages.length === 0) return [];

  const activeSignatures = activeMessages.map((message) => messageSignature(message));
  const matched: TranscriptEntry[] = [];
  let activeIndex = activeSignatures.length - 1;

  for (let entryIndex = entries.length - 1; entryIndex >= 0 && activeIndex >= 0; entryIndex -= 1) {
    const entry = entries[entryIndex];
    if (!entry) continue;
    if (messageSignature(entry.message) !== activeSignatures[activeIndex]) continue;
    matched.unshift(entry);
    activeIndex -= 1;
  }

  return activeIndex < 0 ? matched : undefined;
}

function isAlreadyCompacted(text: string): boolean {
  return text.startsWith(COMPACTED_MARKER);
}

export function analyzeMaintenanceCandidateForMessage(
  message: AnyMessage,
  config: StablePrefixPluginConfig,
): MaintenanceCandidate | undefined {
  const originalText = stringifyTextContent(message.content);
  if (!originalText || isAlreadyCompacted(originalText)) return undefined;

  const blocks = normalizeMessages([message], config);
  const compactedKinds = Array.from(
    new Set(
      blocks
        .map((block) => block.kind)
        .filter((kind) =>
          (config.maintainRewriteKinds ?? [...DEFAULT_MAINTAIN_REWRITE_KINDS]).includes(kind),
        ),
    ),
  );
  if (compactedKinds.length === 0) return undefined;

  const bodyText = blocks
    .filter((block) => block.kind === "stable_user")
    .map((block) => block.text)
    .join("\n\n")
    .trim();

  return {
    bodyText: bodyText || undefined,
    compactedKinds,
    originalText,
  };
}

function artifactFilePath(artifactRoot: string, sessionPartition: string, entryId: string): string {
  const safePartition = sessionPartition.replaceAll(/[^a-zA-Z0-9._-]+/g, "_");
  const safeEntryId = entryId.replaceAll(/[^a-zA-Z0-9._-]+/g, "_");
  return join(artifactRoot, safePartition, `${safeEntryId}.json`);
}

async function writeArtifact(params: {
  artifactRoot: string;
  sessionPartition: string;
  entryId: string;
  originalText: string;
  compactedKinds: PromptStabilityBlockKind[];
  bodyText?: string;
}): Promise<string> {
  const path = artifactFilePath(params.artifactRoot, params.sessionPartition, params.entryId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        entryId: params.entryId,
        compactedKinds: params.compactedKinds,
        bodyText: params.bodyText,
        originalText: params.originalText,
        compactedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return path;
}

export function buildCompactedText(params: {
  artifactRef: string;
  compactedKinds: PromptStabilityBlockKind[];
  bodyText?: string;
}): string {
  const header = `${COMPACTED_MARKER}\nref: ${params.artifactRef}\nkinds: ${params.compactedKinds.join(", ")}`;
  if (params.bodyText) {
    return `${header}\n\n${params.bodyText}\n\n[Injected metadata compacted after send; original available via ref.]`;
  }
  return `${header}\n\n[Injected control-plane context compacted after send; original available via ref.]`;
}

function buildReplacementMessage(original: AnyMessage, text: string): AgentMessage {
  return {
    ...original,
    content: buildTextContentLike(original.content, text),
  } as AgentMessage;
}

export function simulateFutureChurnMaintenance(params: {
  messages: AgentMessage[];
  config: StablePrefixPluginConfig;
  sessionPartition?: string;
}): InMemoryMaintenanceResult {
  if (params.config.maintainMode === "off") {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "maintenance-disabled",
      compactedKinds: {},
      messages: params.messages,
    };
  }

  if (params.messages.length <= (params.config.maintainPreserveTailMessages ?? 8)) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "tail-preserved-only",
      compactedKinds: {},
      messages: params.messages,
    };
  }

  const preserveTail = params.config.maintainPreserveTailMessages ?? 8;
  const maxRewrites = params.config.maintainMaxRewritesPerPass ?? 6;
  const minBytesSaved = params.config.maintainMinBytesSaved ?? 120;
  const nextMessages = [...params.messages];
  const compactedKinds: Partial<Record<PromptStabilityBlockKind, number>> = {};
  let bytesFreed = 0;
  let rewrittenEntries = 0;

  for (let index = 0; index < Math.max(0, nextMessages.length - preserveTail); index += 1) {
    if (rewrittenEntries >= maxRewrites) break;

    const message = nextMessages[index] as AnyMessage | undefined;
    if (!message) continue;

    const analysis = analyzeMaintenanceCandidateForMessage(message, params.config);
    if (!analysis) continue;

    const compactedText = buildCompactedText({
      artifactRef: `memory://${params.sessionPartition ?? "session"}/${message.id ?? index}`,
      compactedKinds: analysis.compactedKinds,
      bodyText: analysis.bodyText,
    });
    const saved = analysis.originalText.length - compactedText.length;
    if (saved < minBytesSaved) continue;

    nextMessages[index] = buildReplacementMessage(message, compactedText);
    bytesFreed += saved;
    rewrittenEntries += 1;
    for (const kind of analysis.compactedKinds) {
      compactedKinds[kind] = (compactedKinds[kind] ?? 0) + 1;
    }
  }

  if (rewrittenEntries === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no-eligible-injected-context",
      compactedKinds: {},
      messages: params.messages,
    };
  }

  return {
    changed: true,
    bytesFreed,
    rewrittenEntries,
    reason: "rewritten",
    compactedKinds,
    messages: nextMessages,
  };
}

export async function runFutureChurnMaintenance(params: {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  activeMessages?: AgentMessage[];
  runtimeContext?: ContextEngineRuntimeContextLike;
  config: StablePrefixPluginConfig;
}): Promise<MaintenanceResult> {
  if (params.config.maintainMode === "off") {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "maintenance-disabled",
      compactedKinds: {},
    };
  }
  if (typeof params.runtimeContext?.rewriteTranscriptEntries !== "function") {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "rewrite-helper-unavailable",
      compactedKinds: {},
    };
  }

  const entries = await loadTranscriptEntries(params.sessionFile);
  const activeEntries = params.activeMessages
    ? matchActiveBranchEntries(entries, params.activeMessages)
    : deriveActiveBranchEntries(entries);

  if (!activeEntries) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "active-branch-match-unavailable",
      compactedKinds: {},
    };
  }

  if (activeEntries.length <= (params.config.maintainPreserveTailMessages ?? 8)) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "tail-preserved-only",
      compactedKinds: {},
    };
  }

  const preserveTail = params.config.maintainPreserveTailMessages ?? 8;
  const maxRewrites = params.config.maintainMaxRewritesPerPass ?? 6;
  const minBytesSaved = params.config.maintainMinBytesSaved ?? 120;
  const artifactRoot =
    params.config.artifactPath ??
    join(process.env.HOME ?? "", ".openclaw/logs/context-engine/stable-prefix-artifacts");
  const sessionPartition = params.sessionKey ?? params.sessionId;

  const replacements: Array<{ entryId: string; message: AgentMessage }> = [];
  let bytesFreed = 0;
  const compactedKinds: Partial<Record<PromptStabilityBlockKind, number>> = {};

  for (const entry of activeEntries.slice(0, Math.max(0, activeEntries.length - preserveTail))) {
    if (replacements.length >= maxRewrites) break;

    const analysis = analyzeMaintenanceCandidateForMessage(entry.message, params.config);
    if (!analysis) continue;

    const artifactRef = await writeArtifact({
      artifactRoot,
      sessionPartition,
      entryId: entry.entryId,
      originalText: analysis.originalText,
      compactedKinds: analysis.compactedKinds,
      bodyText: analysis.bodyText,
    });
    const compactedText = buildCompactedText({
      artifactRef,
      compactedKinds: analysis.compactedKinds,
      bodyText: analysis.bodyText,
    });
    const saved = analysis.originalText.length - compactedText.length;
    if (saved < minBytesSaved) continue;

    replacements.push({
      entryId: entry.entryId,
      message: buildReplacementMessage(entry.message, compactedText),
    });
    bytesFreed += saved;
    for (const kind of analysis.compactedKinds) {
      compactedKinds[kind] = (compactedKinds[kind] ?? 0) + 1;
    }
  }

  if (replacements.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no-eligible-injected-context",
      compactedKinds: {},
    };
  }

  const rewriteResult = await params.runtimeContext.rewriteTranscriptEntries({
    replacements,
  });
  return {
    changed: rewriteResult.changed,
    bytesFreed: rewriteResult.bytesFreed || bytesFreed,
    rewrittenEntries: rewriteResult.rewrittenEntries ?? replacements.length,
    reason: rewriteResult.reason ?? "future-churn-reducer",
    compactedKinds,
  };
}
