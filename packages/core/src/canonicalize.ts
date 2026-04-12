import { stableHash } from "./hash.js";
import type { CanonicalizedBlock, CorePolicyConfig, NormalizedBlock } from "./types.js";

function limit(text: string, maxChars: number | undefined): string {
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function extractConversationBody(text: string): string {
  const messageBodyLabel = "Message body:";
  const idx = text.indexOf(messageBodyLabel);
  if (idx === -1) return text;
  return text.slice(idx + messageBodyLabel.length).trim();
}

function canonicalConversationWrapper(text: string, cfg: CorePolicyConfig): string {
  const body = limit(extractConversationBody(text), cfg.maxConversationWrapperBodyChars ?? 1600);
  return `Conversation metadata wrapper. User-visible body follows.\n${body}`;
}

function canonicalInternalContext(text: string, cfg: CorePolicyConfig): string {
  const stripped = text
    .replaceAll("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>", "")
    .replaceAll("<<<END_OPENCLAW_INTERNAL_CONTEXT>>>", "")
    .trim();
  return `Internal runtime context summary:\n${limit(stripped, cfg.maxInternalContextChars ?? 800)}`;
}

function canonicalReminder(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.includes("Tasklist reminder") || part.includes("scheduled reminder"));
  return line ? `Reminder: ${line}` : "Reminder: scheduled reminder triggered";
}

function canonicalAsyncExecNotice(text: string): string {
  const firstMeaningful = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("System (untrusted):"));
  return firstMeaningful
    ? `Async exec completion: ${firstMeaningful}`
    : "Async exec completion notice";
}

function canonicalQueuedMessages(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  return `Queued messages while busy (${Math.max(lines.length - 1, 0)} lines collapsed)`;
}

export function canonicalizeBlock(
  block: NormalizedBlock,
  cfg: CorePolicyConfig = {},
): CanonicalizedBlock {
  let canonicalText = block.text;
  let decision: CanonicalizedBlock["decision"] = "preserve";

  switch (block.kind) {
    case "conversation_wrapper":
      canonicalText = canonicalConversationWrapper(block.text, cfg);
      decision = "canonicalize";
      break;
    case "internal_runtime_event":
      canonicalText = canonicalInternalContext(block.text, cfg);
      decision = "canonicalize";
      break;
    case "system_reminder":
      canonicalText = canonicalReminder(block.text);
      decision = "canonicalize";
      break;
    case "async_exec_notice":
      canonicalText = canonicalAsyncExecNotice(block.text);
      decision = "canonicalize";
      break;
    case "queued_messages":
      canonicalText = canonicalQueuedMessages(block.text);
      decision = "canonicalize";
      break;
    default:
      break;
  }

  return {
    ...block,
    canonicalText,
    decision,
    hash: stableHash(`${block.kind}:${canonicalText}`),
  };
}
