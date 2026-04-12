import { homedir } from "node:os";

import type { CorePolicyConfig } from "@tontoko/prompt-stability-core";

export type StablePrefixPluginConfig = CorePolicyConfig & {
  telemetryPath?: string;
  rewriteTranscript?: boolean;
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
    rewriteTranscript:
      typeof value.rewriteTranscript === "boolean" ? value.rewriteTranscript : true,
    maxInternalContextChars:
      typeof value.maxInternalContextChars === "number" ? value.maxInternalContextChars : 800,
    maxConversationWrapperBodyChars:
      typeof value.maxConversationWrapperBodyChars === "number"
        ? value.maxConversationWrapperBodyChars
        : 1600,
  };
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
}
