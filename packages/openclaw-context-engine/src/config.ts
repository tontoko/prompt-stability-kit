import { homedir } from "node:os";

import type { CorePolicyConfig, PromptStabilityBlockKind } from "@tontoko/prompt-stability-core";

export type StablePrefixPluginConfig = CorePolicyConfig & {
  telemetryPath?: string;
  maxInternalContextChars?: number;
  maxConversationWrapperBodyChars?: number;
};

export function resolvePluginConfig(raw: unknown): StablePrefixPluginConfig {
  const entry = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const value =
    typeof entry.config === "object" && entry.config
      ? (entry.config as Record<string, unknown>)
      : entry;
  return {
    telemetryPath:
      typeof value.telemetryPath === "string" ? expandHome(value.telemetryPath) : undefined,
    dedupeControlMessages:
      typeof value.dedupeControlMessages === "boolean" ? value.dedupeControlMessages : true,
    maxInternalContextChars:
      typeof value.maxInternalContextChars === "number" ? value.maxInternalContextChars : 800,
    maxConversationWrapperBodyChars:
      typeof value.maxConversationWrapperBodyChars === "number"
        ? value.maxConversationWrapperBodyChars
        : 1600,
    largeBlockChars: typeof value.largeBlockChars === "number" ? value.largeBlockChars : 1200,
    runtimePolicyMode: value.runtimePolicyMode === "off" ? "off" : "pre-frontier-injected-only",
    preFrontierInjectedWindowBlocks:
      typeof value.preFrontierInjectedWindowBlocks === "number"
        ? value.preFrontierInjectedWindowBlocks
        : 3,
    fixedPrefixKinds: parseBlockKindArray(value.fixedPrefixKinds),
    suffixCandidateKinds: parseBlockKindArray(value.suffixCandidateKinds),
    summarizeCandidateKinds: parseBlockKindArray(value.summarizeCandidateKinds),
    dropCandidateKinds: parseBlockKindArray(value.dropCandidateKinds),
    preFrontierInjectedKinds: parseBlockKindArray(value.preFrontierInjectedKinds),
    losslessWholeMovableKinds: parseBlockKindArray(value.losslessWholeMovableKinds),
    futureOnlyKinds: parseBlockKindArray(value.futureOnlyKinds),
    heuristicWeights: parseHeuristicWeights(value.heuristicWeights),
  };
}

const BLOCK_KINDS = new Set<PromptStabilityBlockKind>([
  "system",
  "system_core",
  "tool_inventory",
  "workspace_policy",
  "session_summary",
  "stable_user",
  "assistant_turn",
  "tool_result",
  "conversation_wrapper",
  "internal_runtime_event",
  "system_reminder",
  "async_exec_notice",
  "queued_messages",
  "compaction_summary",
  "other",
]);

function parseBlockKindArray(value: unknown): PromptStabilityBlockKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kinds = value.filter(
    (entry): entry is PromptStabilityBlockKind =>
      typeof entry === "string" && BLOCK_KINDS.has(entry as PromptStabilityBlockKind),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function parseHeuristicWeights(value: unknown): CorePolicyConfig["heuristicWeights"] {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const weights: NonNullable<CorePolicyConfig["heuristicWeights"]> = {};
  if (typeof entry.volatility === "number") weights.volatility = entry.volatility;
  if (typeof entry.prefixValue === "number") weights.prefixValue = entry.prefixValue;
  if (typeof entry.divergence === "number") weights.divergence = entry.divergence;
  if (typeof entry.size === "number") weights.size = entry.size;
  return Object.keys(weights).length > 0 ? weights : undefined;
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
}
