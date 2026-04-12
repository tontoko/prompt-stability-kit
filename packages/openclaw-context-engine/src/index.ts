import {
  buildAssemblyPlan,
  type CanonicalizedBlock,
  computeFirstDivergence,
  type DiagnosticsSnapshot,
} from "@tontoko/prompt-stability-core";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  buildMemorySystemPromptAddition,
  delegateCompactionToRuntime,
} from "openclaw/plugin-sdk/core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { resolvePluginConfig } from "./config.js";
import { canonicalBlocksToMessages } from "./convert.js";
import { collectTranscriptRewrites } from "./maintain.js";
import { normalizeMessages } from "./normalize.js";
import { writeTelemetry } from "./telemetry.js";

type RuntimeContextLike = {
  promptCache?: {
    retention?: string;
    observation?: {
      broke?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  rewriteTranscriptEntries?: (request: {
    replacements: Array<{
      entryId: string;
      message: Record<string, unknown>;
    }>;
  }) => Promise<{
    changed: boolean;
    bytesFreed: number;
    rewrittenEntries: number;
    reason?: string;
  }>;
};

function buildSnapshot(params: {
  blocks: CanonicalizedBlock[];
  previousBlocks?: CanonicalizedBlock[];
  sessionId?: string;
  model?: string;
  estimatedChars: number;
  promptCache?: RuntimeContextLike["promptCache"];
}): DiagnosticsSnapshot {
  const blockCounts = params.blocks.reduce<Record<string, number>>((acc, block) => {
    acc[block.kind] = (acc[block.kind] ?? 0) + 1;
    return acc;
  }, {});

  return {
    timestamp: new Date().toISOString(),
    engineId: "stable-prefix-context",
    sessionId: params.sessionId,
    model: params.model,
    estimatedChars: params.estimatedChars,
    blockCounts,
    firstDivergence: computeFirstDivergence(params.previousBlocks, params.blocks),
    promptCache: params.promptCache,
  };
}

export default definePluginEntry({
  id: "stable-prefix-context",
  name: "Stable Prefix Context",
  description: "Cache-friendly OpenClaw context engine built on prompt-stability-core.",
  kind: "context-engine",
  register(api) {
    api.registerContextEngine("stable-prefix-context", () => {
      let previousBlocks: CanonicalizedBlock[] | undefined;

      return {
        info: {
          id: "stable-prefix-context",
          name: "Stable Prefix Context",
          ownsCompaction: false,
        },

        async ingest() {
          return { ingested: true };
        },

        async assemble(params) {
          const cfg = resolvePluginConfig(loadConfig().plugins?.entries?.["stable-prefix-context"]);
          const normalized = normalizeMessages(params.messages);
          const plan = buildAssemblyPlan(normalized, cfg);
          const snapshot = buildSnapshot({
            blocks: plan.blocks,
            previousBlocks,
            sessionId: params.sessionId,
            model: params.model,
            estimatedChars: plan.estimatedChars,
          });
          previousBlocks = plan.blocks;
          await writeTelemetry(cfg.telemetryPath, snapshot);

          return {
            messages: canonicalBlocksToMessages(plan.blocks),
            estimatedTokens: Math.ceil(plan.estimatedChars / 4),
            systemPromptAddition: buildMemorySystemPromptAddition({
              availableTools: params.availableTools ?? new Set<string>(),
              citationsMode: params.citationsMode as never,
            }),
          };
        },

        async maintain(params) {
          const cfg = resolvePluginConfig(loadConfig().plugins?.entries?.["stable-prefix-context"]);
          if (
            !cfg.rewriteTranscript ||
            typeof params.runtimeContext?.rewriteTranscriptEntries !== "function"
          ) {
            return {
              changed: false,
              bytesFreed: 0,
              rewrittenEntries: 0,
              reason: "rewrite-disabled",
            };
          }
          const replacements = await collectTranscriptRewrites({
            sessionFile: params.sessionFile,
            policy: {
              maxConversationWrapperBodyChars: cfg.maxConversationWrapperBodyChars,
              maxInternalContextChars: cfg.maxInternalContextChars,
            },
          });
          if (replacements.length === 0) {
            return { changed: false, bytesFreed: 0, rewrittenEntries: 0, reason: "no-candidates" };
          }
          return await params.runtimeContext.rewriteTranscriptEntries({ replacements });
        },

        async afterTurn(params) {
          const cfg = resolvePluginConfig(loadConfig().plugins?.entries?.["stable-prefix-context"]);
          await writeTelemetry(cfg.telemetryPath, {
            timestamp: new Date().toISOString(),
            engineId: "stable-prefix-context",
            sessionId: params.sessionId,
            estimatedChars: 0,
            blockCounts: {},
            promptCache: params.runtimeContext?.promptCache,
          });
        },

        async compact(params: Parameters<typeof delegateCompactionToRuntime>[0]) {
          return await delegateCompactionToRuntime(params);
        },
      };
    });
  },
});
