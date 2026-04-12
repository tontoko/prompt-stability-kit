import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { CanonicalizedBlock } from "@tontoko/prompt-stability-core";

type CanonicalizedOpenClawBlock = CanonicalizedBlock & {
  originalMessage?: Record<string, unknown>;
};

function toTextParts(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

function replaceMessageContent(
  originalMessage: Record<string, unknown> | undefined,
  canonicalText: string,
  role: string,
): AgentMessage {
  const base: Record<string, unknown> = originalMessage ? { ...originalMessage } : { role };
  if (Array.isArray(base.content)) {
    base.content = toTextParts(canonicalText);
  } else {
    base.content = canonicalText;
  }
  if (typeof base.role !== "string") {
    base.role = role;
  }
  return base as unknown as AgentMessage;
}

export function canonicalBlocksToMessages(blocks: CanonicalizedOpenClawBlock[]): AgentMessage[] {
  return blocks.map((block) =>
    replaceMessageContent(
      block.originalMessage,
      block.canonicalText,
      block.role === "other" ? "user" : block.role,
    ),
  );
}
