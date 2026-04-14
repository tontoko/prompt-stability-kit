import {
  applyPreFrontierInjectionPolicy,
  computePreFrontierInjectionPolicy,
  type DiagnosticsSnapshot,
  type EnrichedBlock,
  enrichBlocks,
} from "@tontoko/prompt-stability-core";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { delegateCompactionToRuntime } from "openclaw/plugin-sdk/core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { resolvePluginConfig } from "./config.js";
import { runFutureChurnMaintenance } from "./maintain.js";
import { normalizeMessages } from "./normalize.js";
import { writeTelemetry } from "./telemetry.js";

export type { StablePrefixPluginConfig } from "./config.js";
export {
  analyzeMaintenanceCandidateForMessage,
  buildCompactedText,
  runFutureChurnMaintenance,
  simulateFutureChurnMaintenance,
} from "./maintain.js";
export { normalizeMessages } from "./normalize.js";

const previousBlocksBySession = new Map<string, EnrichedBlock[]>();

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
  blocks: Array<{ kind: string; text: string }>;
  sessionId?: string;
  model?: string;
  estimatedChars: number;
  promptCache?: RuntimeContextLike["promptCache"];
  sessionKey?: string;
  agentId?: string;
  runtimePolicy?: DiagnosticsSnapshot["runtimePolicy"];
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
    promptCache: params.promptCache,
    runtimePolicy: params.runtimePolicy,
  };
}

function getHistoryKey(params: {
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): string | undefined {
  return params.sessionKey ?? params.sessionId ?? params.agentId;
}

export default definePluginEntry({
  id: "stable-prefix-context",
  name: "Stable Prefix Context",
  description: "Cache-friendly OpenClaw context engine built on prompt-stability-core.",
  kind: "context-engine",
  register(api) {
    api.registerContextEngine("stable-prefix-context", () => {
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
          const sessionKey = (params as { sessionKey?: string }).sessionKey;
          const agentId = (params as { agentId?: string }).agentId;
          const historyKey = getHistoryKey({
            sessionKey,
            sessionId: params.sessionId,
            agentId,
          });
          const normalized = normalizeMessages(params.messages, cfg);
          const blocks = enrichBlocks(normalized, cfg);
          const runtimePolicy = computePreFrontierInjectionPolicy({
            blocks,
            previousBlocks: historyKey ? previousBlocksBySession.get(historyKey) : undefined,
            config: cfg,
          });
          const ordered = applyPreFrontierInjectionPolicy(normalized, runtimePolicy);
          const orderedBlocks = applyPreFrontierInjectionPolicy(blocks, runtimePolicy);
          const snapshot = buildSnapshot({
            blocks: orderedBlocks,
            sessionId: params.sessionId,
            sessionKey,
            agentId,
            model: params.model,
            estimatedChars: orderedBlocks.reduce((sum, block) => sum + block.text.length, 0),
            runtimePolicy: {
              applied: runtimePolicy.applied,
              reason: runtimePolicy.reason,
              firstDivergenceIndex: runtimePolicy.firstDivergence?.index,
              moveStartIndex: runtimePolicy.moveStartIndex,
              moveEndIndex: runtimePolicy.moveEndIndex,
              movedStableIds: runtimePolicy.movedStableIds,
              baselinePrefixChars: runtimePolicy.baselinePrefixChars,
              optimizedPrefixChars: runtimePolicy.optimizedPrefixChars,
              upliftChars: runtimePolicy.upliftChars,
            },
          });
          if (historyKey) {
            previousBlocksBySession.set(historyKey, orderedBlocks);
          }
          await writeTelemetry(cfg.telemetryPath, snapshot);

          return {
            messages: runtimePolicy.applied
              ? ordered.flatMap((block) => block.toMessages())
              : params.messages,
            estimatedTokens: Math.ceil(snapshot.estimatedChars / 4),
          };
        },

        async maintain(params) {
          const cfg = resolvePluginConfig(loadConfig().plugins?.entries?.["stable-prefix-context"]);
          const result = {
            changed: false,
            bytesFreed: 0,
            rewrittenEntries: 0,
            reason: "deferred-to-after-turn",
            compactedKinds: {},
          };
          await writeTelemetry(cfg.telemetryPath, {
            timestamp: new Date().toISOString(),
            engineId: "stable-prefix-context",
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            estimatedChars: 0,
            blockCounts: {},
            maintenance: {
              changed: result.changed,
              reason: result.reason,
              rewrittenEntries: result.rewrittenEntries,
              bytesFreed: result.bytesFreed,
              compactedKinds: result.compactedKinds,
            },
          });
          return result;
        },

        async afterTurn(params) {
          const cfg = resolvePluginConfig(loadConfig().plugins?.entries?.["stable-prefix-context"]);
          const maintenanceResult = await runFutureChurnMaintenance({
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            sessionFile: params.sessionFile,
            activeMessages: params.messages,
            runtimeContext: params.runtimeContext,
            config: cfg,
          });
          if (maintenanceResult.changed) {
            const historyKey = getHistoryKey({
              sessionKey: params.sessionKey,
              sessionId: params.sessionId,
              agentId: (params as { agentId?: string }).agentId,
            });
            if (historyKey) previousBlocksBySession.delete(historyKey);
          }
          await writeTelemetry(cfg.telemetryPath, {
            timestamp: new Date().toISOString(),
            engineId: "stable-prefix-context",
            sessionId: params.sessionId,
            sessionKey: (params as { sessionKey?: string }).sessionKey,
            agentId: (params as { agentId?: string }).agentId,
            estimatedChars: 0,
            blockCounts: {},
            promptCache: params.runtimeContext?.promptCache,
            maintenance: {
              changed: maintenanceResult.changed,
              reason: maintenanceResult.reason,
              rewrittenEntries: maintenanceResult.rewrittenEntries,
              bytesFreed: maintenanceResult.bytesFreed,
              compactedKinds: maintenanceResult.compactedKinds,
            },
          });
        },

        async compact(params: Parameters<typeof delegateCompactionToRuntime>[0]) {
          return await delegateCompactionToRuntime(params);
        },
      };
    });
  },
});
