import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { NormalizedBlock, PromptStabilityRole } from "@tontoko/prompt-stability-core";
import { classifyBlock } from "@tontoko/prompt-stability-core";

type AnyMessage = {
  role?: string;
  content?: unknown;
  id?: string;
  toolName?: string;
  [key: string]: unknown;
};

export type NormalizedOpenClawBlock = NormalizedBlock & {
  originalMessage: AnyMessage;
  toMessage: () => AgentMessage;
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
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string" &&
          (!("type" in part) ||
            part.type === "text" ||
            part.type === "input_text" ||
            part.type === "output_text")
        ) {
          return part.text;
        }
        return "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content, null, 2);
  return String(content ?? "");
}

function toTextParts(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

function buildMessage(value: AnyMessage, role: PromptStabilityRole, text: string): AgentMessage {
  const next: Record<string, unknown> = { ...value, role: role === "other" ? "user" : role };
  if (Array.isArray(value.content)) {
    next.content = toTextParts(text);
  } else {
    next.content = text;
  }
  return next as unknown as AgentMessage;
}

function splitConversationWrapper(text: string): { wrapper: string; body: string } | undefined {
  const messageBodyLabel = "Message body:";
  const labeledIndex = text.indexOf(messageBodyLabel);
  if (labeledIndex >= 0) {
    const wrapper = text.slice(0, labeledIndex).trim();
    const body = text.slice(labeledIndex + messageBodyLabel.length).trim();
    if (wrapper && body) return { wrapper, body };
  }

  if (text.startsWith("Sender (untrusted metadata):")) {
    const firstFence = text.indexOf("```");
    if (firstFence >= 0) {
      const secondFence = text.indexOf("```", firstFence + 3);
      if (secondFence >= 0) {
        const wrapper = text.slice(0, secondFence + 3).trim();
        const body = text.slice(secondFence + 3).trim();
        if (wrapper && body) return { wrapper, body };
      }
    }
  }

  return undefined;
}

function makeBlock(params: {
  value: AnyMessage;
  role: PromptStabilityRole;
  index: number;
  id: string;
  text: string;
  stableId?: string;
  source?: string;
  positionConstraint?: NormalizedBlock["positionConstraint"];
  kind?: NormalizedBlock["kind"];
}): NormalizedOpenClawBlock {
  const base = {
    id: params.id,
    role: params.role,
    originalIndex: params.index,
    text: params.text,
    stableId: params.stableId,
    source: params.source,
    positionConstraint: params.positionConstraint,
  };

  return {
    ...base,
    kind: params.kind ?? classifyBlock(base),
    originalMessage: params.value,
    toMessage: () => buildMessage(params.value, params.role, params.text),
  };
}

export function normalizeMessages(messages: unknown[]): NormalizedOpenClawBlock[] {
  return messages.flatMap((message, index) => {
    const value = (message ?? {}) as AnyMessage;
    const role = normalizeRole(value.role);
    const text = stringifyContent(value.content);
    const id = typeof value.id === "string" ? value.id : `message-${index}`;
    const split = splitConversationWrapper(text);

    if (split) {
      return [
        makeBlock({
          value,
          role,
          index,
          id: `${id}:wrapper`,
          stableId: `${id}:wrapper`,
          text: split.wrapper,
          source: "conversation_wrapper",
          positionConstraint: "suffix_candidate",
          kind: "conversation_wrapper",
        }),
        makeBlock({
          value,
          role,
          index,
          id: `${id}:body`,
          stableId: `${id}:body`,
          text: split.body,
          source: "conversation_body",
          positionConstraint: "prefix_candidate",
          kind:
            role === "user"
              ? "stable_user"
              : classifyBlock({
                  id: `${id}:body`,
                  role,
                  originalIndex: index,
                  text: split.body,
                }),
        }),
      ];
    }

    const block = makeBlock({
      value,
      role,
      index,
      id,
      stableId: id,
      text,
    });

    const volatileKinds = new Set([
      "conversation_wrapper",
      "internal_runtime_event",
      "system_reminder",
      "async_exec_notice",
      "queued_messages",
      "compaction_summary",
    ]);

    if (volatileKinds.has(block.kind)) {
      block.positionConstraint = "suffix_candidate";
    }

    return [block];
  });
}
