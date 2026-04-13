import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssembledBlock } from "@tontoko/prompt-stability-core";

type AssembledOpenClawBlock = AssembledBlock & {
  originalMessage?: Record<string, unknown>;
  toMessages?: () => AgentMessage[];
};

export function assembledBlocksToMessages(blocks: AssembledOpenClawBlock[]): AgentMessage[] {
  return blocks.flatMap((block) => {
    if (typeof block.toMessages === "function") {
      return block.toMessages();
    }
    return [
      {
        role: block.role === "other" ? "user" : block.role,
        content: block.assembledText,
      } as AgentMessage,
    ];
  });
}
