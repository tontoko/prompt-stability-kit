import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  CorePolicyConfig,
  NormalizedBlock,
  PromptStabilityRole,
} from "@tontoko/prompt-stability-core";
import { classifyBlock, defaultSliceabilityForKind } from "@tontoko/prompt-stability-core";

type AnyMessage = {
  role?: string;
  content?: unknown;
  id?: string;
  toolName?: string;
  [key: string]: unknown;
};

export type NormalizedOpenClawBlock = NormalizedBlock & {
  originalMessage: AnyMessage;
  toMessages: () => AgentMessage[];
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

function extractTextualBlob(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
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
      parts.push(part.text);
      continue;
    }
    return undefined;
  }

  return parts.join("\n");
}

function buildTextContentLike(originalContent: unknown, text: string): unknown {
  if (Array.isArray(originalContent)) {
    return [{ type: "text", text }];
  }
  return text;
}

function buildTextMessage(
  value: AnyMessage,
  role: PromptStabilityRole,
  text: string,
  id: string,
): AgentMessage {
  return {
    ...value,
    id,
    role: role === "other" ? "user" : role,
    content: buildTextContentLike(value.content, text),
  } as unknown as AgentMessage;
}

function splitConversationWrapper(text: string): { wrapper: string; body: string } | undefined {
  const messageBodyLabel = "Message body:";
  const labeledIndex = text.indexOf(messageBodyLabel);
  if (labeledIndex >= 0) {
    const wrapper = text.slice(0, labeledIndex).trim();
    const body = text.slice(labeledIndex + messageBodyLabel.length).trim();
    if (wrapper && body) return { wrapper, body };
  }

  if (text.startsWith("Sender (untrusted metadata):") || text.startsWith("Sender info:")) {
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

  if (
    text.startsWith("Conversation info (untrusted metadata):") ||
    text.startsWith("Conversation info:")
  ) {
    const fenceIndices: number[] = [];
    let from = 0;
    while (true) {
      const index = text.indexOf("```", from);
      if (index < 0) break;
      fenceIndices.push(index);
      from = index + 3;
    }
    const lastFence = fenceIndices.at(-1);
    if (lastFence !== undefined) {
      const body = text.slice(lastFence + 3).trim();
      const wrapper = text.slice(0, lastFence + 3).trim();
      if (wrapper && body) return { wrapper, body };
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
  sliceability?: NormalizedBlock["sliceability"];
  kind?: NormalizedBlock["kind"];
  config?: CorePolicyConfig;
  toMessages?: () => AgentMessage[];
}): NormalizedOpenClawBlock {
  const base = {
    id: params.id,
    role: params.role,
    originalIndex: params.index,
    text: params.text,
    stableId: params.stableId,
    source: params.source,
    positionConstraint: params.positionConstraint,
    sliceability: params.sliceability,
  };

  const kind = params.kind ?? classifyBlock(base);

  return {
    ...base,
    kind,
    sliceability: params.sliceability ?? defaultSliceabilityForKind(kind, params.config),
    originalMessage: params.value,
    toMessages: params.toMessages ?? (() => [params.value as unknown as AgentMessage]),
  };
}

export function normalizeMessages(
  messages: unknown[],
  config: CorePolicyConfig = {},
): NormalizedOpenClawBlock[] {
  return messages.flatMap((message, index) => {
    const value = (message ?? {}) as AnyMessage;
    const role = normalizeRole(value.role);
    const text = stringifyContent(value.content);
    const id = typeof value.id === "string" ? value.id : `message-${index}`;
    const textualBlob = extractTextualBlob(value.content);
    const split = textualBlob ? splitConversationWrapper(textualBlob) : undefined;

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
          sliceability: "lossless_split_child_movable",
          kind: "conversation_wrapper",
          config,
          toMessages: () => [buildTextMessage(value, role, split.wrapper, `${id}:wrapper`)],
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
          sliceability: "non_movable",
          kind:
            role === "user"
              ? "stable_user"
              : classifyBlock({
                  id: `${id}:body`,
                  role,
                  originalIndex: index,
                  text: split.body,
                }),
          config,
          toMessages: () => [buildTextMessage(value, role, split.body, `${id}:body`)],
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
      config,
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
