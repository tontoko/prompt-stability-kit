export type PromptStabilityBlockKind =
  | "system"
  | "system_core"
  | "tool_inventory"
  | "workspace_policy"
  | "session_summary"
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

export type BlockPositionConstraint = "fixed_prefix" | "prefix_candidate" | "suffix_candidate";

export type BlockSliceability =
  | "non_movable"
  | "lossless_whole_movable"
  | "lossless_split_child_movable"
  | "future_only";

export type PromptStabilityDecision = "prefix_required" | "suffix_ok" | "summarize_ok" | "drop_ok";

export type DecisionRegion =
  | "fixed_prefix"
  | "working_prefix"
  | "suffix"
  | "summary_candidate"
  | "dropped";

export type NormalizedBlock = {
  id: string;
  role: PromptStabilityRole;
  originalIndex: number;
  text: string;
  kind: PromptStabilityBlockKind;
  stableId?: string;
  source?: string;
  positionConstraint?: BlockPositionConstraint;
  sliceability?: BlockSliceability;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type BlockFeatures = {
  charLength: number;
  lineCount: number;
  estimatedTokens: number;
  isControlLike: boolean;
  isVolatile: boolean;
  isLarge: boolean;
  volatilityScore: number;
  prefixValueScore: number;
};

export type EnrichedBlock = NormalizedBlock & {
  stableId: string;
  stableHash: string;
  semanticHash: string;
  features: BlockFeatures;
};

export type DecisionScorecard = {
  prefixRequired: number;
  suffixOk: number;
  summarizeOk: number;
  dropOk: number;
};

export type BlockDecision = {
  blockId: string;
  stableId: string;
  decision: PromptStabilityDecision;
  confidence: number;
  locked: boolean;
  reasons: string[];
  region: DecisionRegion;
  scores: DecisionScorecard;
};

export type AssembledBlock = EnrichedBlock & {
  assembledText: string;
  hash: string;
  decision: PromptStabilityDecision;
  confidence: number;
  region: DecisionRegion;
};

export type FirstDivergence = {
  index: number;
  previousKind?: PromptStabilityBlockKind;
  currentKind?: PromptStabilityBlockKind;
  previousHash?: string;
  currentHash?: string;
  previousStableId?: string;
  currentStableId?: string;
};

export type FixedPrefixBoundary = {
  index: number;
  stableIds: string[];
};

export type DiagnosticsSnapshot = {
  timestamp: string;
  engineId: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  model?: string;
  estimatedChars: number;
  blockCounts: Partial<Record<PromptStabilityBlockKind, number>>;
  decisionCounts?: Partial<Record<PromptStabilityDecision, number>>;
  firstDivergence?: FirstDivergence;
  promptCache?: {
    retention?: string;
    observation?: {
      broke?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  runtimePolicy?: {
    applied: boolean;
    reason: string;
    firstDivergenceIndex?: number;
    moveStartIndex?: number;
    moveEndIndex?: number;
    movedStableIds?: string[];
    baselinePrefixChars?: number;
    optimizedPrefixChars?: number;
    upliftChars?: number;
  };
};

export type CorePolicyConfig = {
  fixedPrefixKinds?: PromptStabilityBlockKind[];
  fixedPrefixIds?: string[];
  fixedPrefixBoundaryMode?: "leading-fixed-run" | "none";
  suffixCandidateKinds?: PromptStabilityBlockKind[];
  summarizeCandidateKinds?: PromptStabilityBlockKind[];
  dropCandidateKinds?: PromptStabilityBlockKind[];
  largeBlockChars?: number;
  divergenceLookahead?: number;
  dedupeControlMessages?: boolean;
  minConfidenceToReorder?: number;
  runtimePolicyMode?: "pre-frontier-injected-only" | "off";
  preFrontierInjectedKinds?: PromptStabilityBlockKind[];
  preFrontierInjectedWindowBlocks?: number;
  heuristicWeights?: Partial<{
    volatility: number;
    prefixValue: number;
    divergence: number;
    size: number;
  }>;
};

export type OptimizationRequest = {
  blocks: NormalizedBlock[];
  previousBlocks?: Array<Pick<AssembledBlock, "stableId" | "hash" | "kind">>;
  config?: CorePolicyConfig;
};

export type AssemblyPlan = {
  blocks: AssembledBlock[];
  prefixBlocks: AssembledBlock[];
  suffixBlocks: AssembledBlock[];
  summaryCandidates: AssembledBlock[];
  droppedBlocks: AssembledBlock[];
  decisions: BlockDecision[];
  estimatedChars: number;
  blockCounts: Partial<Record<PromptStabilityBlockKind, number>>;
  firstDivergence?: FirstDivergence;
  fixedPrefixBoundary: FixedPrefixBoundary;
};

export type RuntimePolicyPlan = {
  applied: boolean;
  reason: string;
  firstDivergence?: FirstDivergence;
  moveStartIndex?: number;
  moveEndIndex?: number;
  movedStableIds: string[];
  baselinePrefixChars?: number;
  optimizedPrefixChars?: number;
  upliftChars?: number;
};
