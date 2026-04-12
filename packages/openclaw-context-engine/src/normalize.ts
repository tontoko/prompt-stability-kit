import type { NormalizedBlock, PromptStabilityRole } from "@tontoko/prompt-stability-core";
import { classifyBlock } from "@tontoko/prompt-stability-core";

type AnyMessage = {
  role?: string;
  content?: unknown;
  id?: string;
  toolName?: string;
};

export type NormalizedOpenClawBlock = NormalizedBlock & {
  originalMessage: AnyMessage;
};

function normalizeRole(input: string | undefined): PromptStabilityRole {
  if (input === "system" || input === "user" || input === "assistant" || input === "tool") {
    return input;
  }
  return "other";
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content, null, 2);
  return String(content ?? "");
}

export function normalizeMessages(messages: unknown[]): NormalizedOpenClawBlock[] {
  return messages.map((message, index) => {
    const value = (message ?? {}) as AnyMessage;
    const role = normalizeRole(value.role);
    const text = stringifyContent(value.content);
    const base = {
      id: typeof value.id === "string" ? value.id : `message-${index}`,
      role,
      originalIndex: index,
      text,
    };
    return {
      ...base,
      kind: classifyBlock(base),
      originalMessage: value,
    };
  });
}
