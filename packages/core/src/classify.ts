import type { NormalizedBlock, PromptStabilityBlockKind } from "./types.js";

const CONVERSATION_WRAPPER_PREFIX = "Conversation info (untrusted metadata):";
const INTERNAL_CONTEXT_PREFIX = "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>";
const QUEUED_MESSAGES_PREFIX = "[Queued messages while agent was busy]";

export function classifyBlock(block: Omit<NormalizedBlock, "kind">): PromptStabilityBlockKind {
  const text = block.text.trim();
  if (block.role === "system") return "system";
  if (block.role === "assistant") return "assistant_turn";
  if (block.role === "tool") return "tool_result";
  if (text.startsWith(CONVERSATION_WRAPPER_PREFIX)) return "conversation_wrapper";
  if (text.includes(INTERNAL_CONTEXT_PREFIX)) return "internal_runtime_event";
  if (text.includes(QUEUED_MESSAGES_PREFIX)) return "queued_messages";
  if (
    text.startsWith("System: [") &&
    text.includes("Tasklist reminder") &&
    text.includes("scheduled reminder")
  ) {
    return "system_reminder";
  }
  if (text.includes("An async command you ran earlier has completed")) {
    return "async_exec_notice";
  }
  if (text.includes("compaction summary") || text.startsWith("[Compaction summary]")) {
    return "compaction_summary";
  }
  if (block.role === "user") return "stable_user";
  return "other";
}
