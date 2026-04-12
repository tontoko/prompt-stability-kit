import {
  type AssembledBlock,
  buildOptimizationPlan,
  type DiagnosticsSnapshot,
} from "@tontoko/prompt-stability-core";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  buildMemorySystemPromptAddition,
  delegateCompactionToRuntime,
} from "openclaw/plugin-sdk/core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { resolvePluginConfig } from "./config.js";
import { assembledBlocksToMessages } from "./convert.js";
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
};

function buildSnapshot(params: {
  blocks: AssembledBlock[];
  previousBlocks?: AssembledBlock[];
  sessionId?: string;
  model?: string;
  estimatedChars: number;
  promptCache?: RuntimeContextLike["promptCache"];
  sessionKey?: string;
  agentId?: string;
  decisionCounts?: DiagnosticsSnapshot["decisionCounts"];
  firstDivergence?: DiagnosticsSnapshot["firstDivergence"];
}): DiagnosticsSnapshot {
  const blockCounts = params.blocks.reduce<Record<string, number>>((acc, block) => {
    acc[block.kind] = (acc[block.kind] ?? 0) + 1;
    return acc;
  }, {});

  return {
    timestamp: new Date().toISOString(),
    engineId: "stable-prefix-context",
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    model: params.model,
    estimatedChars: params.estimatedChars,
    blockCounts,
    decisionCounts: params.decisionCounts,
    firstDivergence: params.firstDivergence,
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
      let previousBlocks: AssembledBlock[] | undefined;

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
          const plan = buildOptimizationPlan({
            blocks: normalized,
            previousBlocks: previousBlocks?.map((block) => ({
              stableId: block.stableId,
              hash: block.hash,
              kind: block.kind,
            })),
            config: cfg,
          });
          const decisionCounts = plan.decisions.reduce<Record<string, number>>((acc, decision) => {
            acc[decision.decision] = (acc[decision.decision] ?? 0) + 1;
            return acc;
          }, {});
          const snapshot = buildSnapshot({
            blocks: plan.blocks,
            previousBlocks,
            sessionId: params.sessionId,
            sessionKey: (params as { sessionKey?: string }).sessionKey,
            agentId: (params as { agentId?: string }).agentId,
            model: params.model,
            estimatedChars: plan.estimatedChars,
            decisionCounts,
            firstDivergence: plan.firstDivergence,
          });
          previousBlocks = plan.blocks;
          await writeTelemetry(cfg.telemetryPath, snapshot);

          return {
            messages: assembledBlocksToMessages(plan.blocks),
            estimatedTokens: Math.ceil(plan.estimatedChars / 4),
            systemPromptAddition: buildMemorySystemPromptAddition({
              availableTools: params.availableTools ?? new Set<string>(),
              citationsMode: params.citationsMode as never,
            }),
          };
        },

        async maintain(params) {
          void params;
          return {
            changed: false,
            bytesFreed: 0,
            rewrittenEntries: 0,
            reason: "reordering-only",
          };
        },

        async afterTurn(params) {
          const cfg = resolvePluginConfig(loadConfig().plugins?.entries?.["stable-prefix-context"]);
          await writeTelemetry(cfg.telemetryPath, {
            timestamp: new Date().toISOString(),
            engineId: "stable-prefix-context",
            sessionId: params.sessionId,
            sessionKey: (params as { sessionKey?: string }).sessionKey,
            agentId: (params as { agentId?: string }).agentId,
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
