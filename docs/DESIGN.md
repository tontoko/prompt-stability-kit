# Design

## Problem

Prompt-cache misses in long-lived agent sessions are often caused by small
volatile wrapper changes near the front of the assembled prompt. The expensive
failures are not average misses; they are large severe misses where a long
conversation prefix is rebuilt because a metadata-heavy control block changed.

For OpenClaw, the first concrete targets are:

- `Conversation info (untrusted metadata): ...`
- `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>> ...`
- scheduled reminder prompts
- async exec completion notices

## Design goals

1. Keep the stable prompt prefix as byte-stable as possible.
2. Reduce volatile wrapper payloads without hiding their semantics.
3. Make the first divergence inspectable.
4. Keep the policy engine reusable outside OpenClaw.

## Monorepo split

### `@tontoko/prompt-stability-core`

Owns:

- message block classification
- deterministic canonicalization
- assembly planning
- divergence analysis
- telemetry shape

Does not own:

- transcript storage
- vendor-specific plugin lifecycle
- transport APIs

### `@tontoko/openclaw-stable-prefix-context`

Owns:

- OpenClaw plugin manifest and slot integration
- context-engine lifecycle wiring
- OpenClaw message normalization
- transcript rewrite requests
- telemetry emission to JSONL

Does not own:

- harness-agnostic policy
- generic diagnostics formats

## Strategy

The initial strategy is conservative.

We do not reorder the full transcript aggressively in v0. We canonicalize the
most volatile wrapper messages first, optionally dedupe exact repeats, and make
those rewrites durable through the runtime transcript rewrite helper.

This makes the first cache-sensitive prefix blocks smaller and more stable
without risking chronology-breaking reorder behavior.

## Assembly flow

1. Normalize incoming messages into `NormalizedBlock` entries.
2. Classify each block with a stable `kind`.
3. Canonicalize supported volatile kinds to short deterministic text.
4. Apply exact-repeat dedupe for reminder-like control blocks.
5. Return assembled messages in original order, but with canonicalized content.
6. Emit a diagnostics snapshot with block hashes and first-divergence data.

## Maintenance flow

`maintain()` is where durable stability work happens.

The adapter requests transcript rewrites for older messages when canonicalized
content differs from the stored payload. That keeps future turns from repeatedly
paying to process verbose wrappers that are no longer needed in full.

## Why not full prompt rewriting?

Freeform LLM rewriting is explicitly out of scope for v0 because it would add
fresh variability to the prefix. The system is designed around deterministic
transforms first.

## Future work

- suffix routing for highly volatile blocks
- optional classifier-assisted decisions
- richer prompt-boundary diagnostics
- additional adapters beyond OpenClaw

