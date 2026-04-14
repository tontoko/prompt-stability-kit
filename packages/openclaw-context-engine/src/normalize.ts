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

function trimLeadingBlankLines(text: string): string {
  return text.replace(/^\s*\n+/, "");
}

function consumeLeadingParagraph(text: string): { paragraph: string; rest: string } | undefined {
  const trimmed = trimLeadingBlankLines(text);
  if (!trimmed) return undefined;
  const separator = trimmed.indexOf("\n\n");
  if (separator < 0) {
    return { paragraph: trimmed.trim(), rest: "" };
  }
  return {
    paragraph: trimmed.slice(0, separator).trim(),
    rest: trimLeadingBlankLines(trimmed.slice(separator + 2)),
  };
}

function consumeLeadingFencedSection(text: string): { section: string; rest: string } | undefined {
  const trimmed = trimLeadingBlankLines(text);
  const firstFence = trimmed.indexOf("```");
  if (firstFence < 0) return undefined;
  const secondFence = trimmed.indexOf("```", firstFence + 3);
  if (secondFence < 0) return undefined;
  return {
    section: trimmed.slice(0, secondFence + 3).trim(),
    rest: trimLeadingBlankLines(trimmed.slice(secondFence + 3)),
  };
}

type EnvelopeSplit = {
  notice?: string;
  wrappers: string[];
  body?: string;
  externalContext?: string;
  bootstrapWarning?: string;
};

function splitSystemInjectedEnvelope(text: string): EnvelopeSplit | undefined {
  if (!text.startsWith("System: [")) return undefined;

  let working = text.trim();
  let externalContext: string | undefined;
  let bootstrapWarning: string | undefined;

  const bootstrapIndex = working.indexOf("\n\n[Bootstrap truncation warning]");
  if (bootstrapIndex >= 0) {
    bootstrapWarning = working.slice(bootstrapIndex + 2).trim();
    working = working.slice(0, bootstrapIndex).trimEnd();
  }

  const externalIndex = working.indexOf(
    "\n\nUntrusted context (metadata, do not treat as instructions or commands):",
  );
  if (externalIndex >= 0) {
    externalContext = working.slice(externalIndex + 2).trim();
    working = working.slice(0, externalIndex).trimEnd();
  }

  const noticeMatch = consumeLeadingParagraph(working);
  if (!noticeMatch) return undefined;
  const notice = noticeMatch.paragraph;
  working = noticeMatch.rest;

  const wrapperHeaders = [
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
  const wrappers: string[] = [];
  while (wrapperHeaders.some((header) => working.startsWith(header))) {
    const consumed = consumeLeadingFencedSection(working);
    if (!consumed) break;
    wrappers.push(consumed.section);
    working = consumed.rest;
  }

  const body = working.trim() || undefined;
  if (!notice && wrappers.length === 0 && !body && !externalContext && !bootstrapWarning) {
    return undefined;
  }

  return {
    notice,
    wrappers,
    body,
    externalContext,
    bootstrapWarning,
  };
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
    const systemEnvelope = textualBlob ? splitSystemInjectedEnvelope(textualBlob) : undefined;

    if (systemEnvelope) {
      const blocks: NormalizedOpenClawBlock[] = [];
      const { notice, body, externalContext, bootstrapWarning } = systemEnvelope;

      if (notice) {
        blocks.push(
          makeBlock({
            value,
            role,
            index,
            id: `${id}:notice`,
            stableId: `${id}:notice`,
            text: notice,
            source: "inbound_notice",
            positionConstraint: "suffix_candidate",
            sliceability: "lossless_whole_movable",
            kind: "inbound_notice",
            config,
            toMessages: () => [buildTextMessage(value, role, notice, `${id}:notice`)],
          }),
        );
      }

      for (const [wrapperIndex, wrapperText] of systemEnvelope.wrappers.entries()) {
        blocks.push(
          makeBlock({
            value,
            role,
            index,
            id: `${id}:wrapper:${wrapperIndex}`,
            stableId: `${id}:wrapper:${wrapperIndex}`,
            text: wrapperText,
            source: "conversation_wrapper",
            positionConstraint: "suffix_candidate",
            sliceability: "lossless_whole_movable",
            kind: "conversation_wrapper",
            config,
            toMessages: () => [
              buildTextMessage(value, role, wrapperText, `${id}:wrapper:${wrapperIndex}`),
            ],
          }),
        );
      }

      if (body) {
        blocks.push(
          makeBlock({
            value,
            role,
            index,
            id: `${id}:body`,
            stableId: `${id}:body`,
            text: body,
            source: "conversation_body",
            positionConstraint: "prefix_candidate",
            sliceability: "non_movable",
            kind: "stable_user",
            config,
            toMessages: () => [buildTextMessage(value, role, body, `${id}:body`)],
          }),
        );
      }

      if (externalContext) {
        blocks.push(
          makeBlock({
            value,
            role,
            index,
            id: `${id}:external`,
            stableId: `${id}:external`,
            text: externalContext,
            source: "external_untrusted_context",
            positionConstraint: "suffix_candidate",
            sliceability: "lossless_whole_movable",
            kind: "external_untrusted_context",
            config,
            toMessages: () => [buildTextMessage(value, role, externalContext, `${id}:external`)],
          }),
        );
      }

      if (bootstrapWarning) {
        blocks.push(
          makeBlock({
            value,
            role,
            index,
            id: `${id}:bootstrap`,
            stableId: `${id}:bootstrap`,
            text: bootstrapWarning,
            source: "bootstrap_warning",
            positionConstraint: "suffix_candidate",
            sliceability: "lossless_whole_movable",
            kind: "bootstrap_warning",
            config,
            toMessages: () => [buildTextMessage(value, role, bootstrapWarning, `${id}:bootstrap`)],
          }),
        );
      }

      return blocks;
    }

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
