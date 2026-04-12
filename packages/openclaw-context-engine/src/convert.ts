import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssembledBlock } from "@tontoko/prompt-stability-core";

type AssembledOpenClawBlock = AssembledBlock & {
  originalMessage?: Record<string, unknown>;
  toMessage?: () => AgentMessage;
};

export function assembledBlocksToMessages(blocks: AssembledOpenClawBlock[]): AgentMessage[] {
  return blocks.map((block) => {
    if (typeof block.toMessage === "function") {
      return block.toMessage();
    }
    return {
      role: block.role === "other" ? "user" : block.role,
      content: block.assembledText,
    } as AgentMessage;
  });
}
