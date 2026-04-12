export type PromptStabilityBlockKind =
  | "system"
  | "stable_user"
  | "assistant_turn"
  | "tool_result"
  | "conversation_wrapper"
  | "internal_runtime_event"
  | "system_reminder"
  | "async_exec_notice"
  | "queued_messages"
  | "compaction_summary"
  | "other";

export type PromptStabilityRole = "system" | "user" | "assistant" | "tool" | "other";

export type NormalizedBlock = {
  id: string;
  role: PromptStabilityRole;
  originalIndex: number;
  text: string;
  kind: PromptStabilityBlockKind;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type CanonicalizationDecision = "preserve" | "canonicalize" | "drop";

export type CanonicalizedBlock = NormalizedBlock & {
  canonicalText: string;
  decision: CanonicalizationDecision;
  hash: string;
};

export type AssemblyPlan = {
  blocks: CanonicalizedBlock[];
  estimatedChars: number;
  blockCounts: Partial<Record<PromptStabilityBlockKind, number>>;
};

export type FirstDivergence = {
  index: number;
  previousHash?: string;
  currentHash?: string;
};

export type DiagnosticsSnapshot = {
  timestamp: string;
  engineId: string;
  sessionId?: string;
  model?: string;
  estimatedChars: number;
  blockCounts: Partial<Record<PromptStabilityBlockKind, number>>;
  firstDivergence?: FirstDivergence;
  promptCache?: {
    retention?: string;
    observation?: {
      broke?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

export type CorePolicyConfig = {
  dedupeControlMessages?: boolean;
  maxConversationWrapperBodyChars?: number;
  maxInternalContextChars?: number;
};
