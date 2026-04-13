# Block Model

## Purpose

The block model defines the lossless optimization units used by
`prompt-stability-kit`.

The optimizer exists to preserve exact prompt-prefix identity for as long as
possible. It must not rewrite message meaning.

## Entities

### Message

A harness-native message object. Examples:

- OpenClaw `AgentMessage`
- a user message envelope from a session transcript
- an assistant message with structured content

Messages are the source of truth. They are never rewritten by the optimizer.

### Slice

A lossless textual segment extracted from a message.

A slice must satisfy all of the following:

- it is derived directly from original message bytes/text
- it can be re-emitted without semantic loss
- it can be reattached to its source message deterministically
- it never invents or paraphrases content

A slice is the smallest lossless unit the adapter may reason about.

### Span

One or more slices grouped together because they must move as a unit.

Examples:

- a latest user body plus required trailing metadata
- a tool call/result pair that should remain adjacent
- a control wrapper that is indivisible in the current adapter

The ordering engine works on spans, not raw messages.

### Frontier

The stable prefix boundary beyond which the optimizer may consider movement.

Everything before the frontier is fixed for the current turn. Everything after
the frontier is a candidate tail.

## Losslessness rules

The optimizer may only move data that is lossless under re-emission.

A block is losslessly movable only if:

- its textual boundaries are exact
- moving it does not change message semantics
- moving it does not break structured content meaning
- it can be reconstructed as original message slices without regeneration

If any of these fail, the block is atomic.

## Sliceability classes

The core uses an explicit `sliceability` enum.

### `non_movable`

The block must remain in place for the current turn.

Examples:

- assistant structured content with tool calls or reasoning parts
- tool results whose ordering is semantically coupled to adjacent content
- any message content that cannot be split without regeneration

### `lossless_whole_movable`

The entire block is movable as a unit without semantic loss.

### `lossless_split_child_movable`

Part of the original message can be split into a movable child span while the
semantic body remains fixed.

Current OpenClaw example:

- a conversation wrapper metadata span split away from its user-visible body

### `future_only`

The block is not safe for current-turn movement, but may later become a
future-churn candidate for summary/reference workflows after an unavoidable
miss.

## Required block metadata

Each normalized block or span must carry enough information to support lossless
re-emission or a conservative no-op:

- `id`
- `stableId`
- `kind`
- `role`
- `text`
- `positionConstraint`
- `sliceability`
- optional harness-specific metadata needed by the adapter

## OpenClaw-specific notes

For OpenClaw, the adapter should assume the following by default:

- normal user messages are atomic unless a known wrapper format can be split
- assistant messages are atomic unless proven otherwise
- tool messages are atomic unless a specific adapter rule proves safe adjacency
- runtime/internal wrappers are movable only when the adapter has an explicit,
  lossless whole-block proof for that wrapper kind

## Invariants

The optimizer must preserve these invariants:

1. No transcript rewriting.
2. No synthetic text generation in the runtime path.
3. Every optimized prompt can be traced back to original message slices.
4. If a slice/span is not proven movable, it stays in place.
5. Runtime optimization is allowed only on explicitly sliceable spans.
