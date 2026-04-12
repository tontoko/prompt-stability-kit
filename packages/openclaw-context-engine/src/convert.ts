import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { CanonicalizedBlock } from "@tontoko/prompt-stability-core";

export function canonicalBlocksToMessages(blocks: CanonicalizedBlock[]): AgentMessage[] {
  return blocks.map((block) => ({
    role: block.role === "other" ? "user" : block.role,
    content: block.canonicalText,
  })) as AgentMessage[];
}
