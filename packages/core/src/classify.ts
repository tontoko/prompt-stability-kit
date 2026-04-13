import type { NormalizedBlock, PromptStabilityBlockKind } from "./types.js";

const CONVERSATION_WRAPPER_PREFIXES = [
  "Conversation info (untrusted metadata):",
  "Conversation info:",
  "Sender (untrusted metadata):",
  "Sender info:",
  "Thread starter (untrusted, for context):",
  "Thread starter:",
  "Replied message (untrusted, for context):",
  "Reply context:",
  "Forwarded message context (untrusted metadata):",
  "Forwarded context:",
  "Chat history since last reply (untrusted, for context):",
  "Recent chat history:",
];
const INTERNAL_CONTEXT_PREFIX = "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>";
const QUEUED_MESSAGES_PREFIXES = [
  "[Queued messages while agent was busy]",
  "[Queued messages while busy]",
];

export function classifyBlock(block: Omit<NormalizedBlock, "kind">): PromptStabilityBlockKind {
  const text = block.text.trim();
  if (block.role === "system") return "system";
  if (block.role === "assistant") return "assistant_turn";
  if (block.role === "tool") return "tool_result";
  if (CONVERSATION_WRAPPER_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return "conversation_wrapper";
  }
  if (text.includes(INTERNAL_CONTEXT_PREFIX)) return "internal_runtime_event";
  if (QUEUED_MESSAGES_PREFIXES.some((prefix) => text.includes(prefix))) {
    return "queued_messages";
  }
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
