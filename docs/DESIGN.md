# Design

## Problem statement

Prompt caches fail when the front of the prompt stops matching exactly. In
long-lived agent sessions, the expensive misses are usually caused by small but
volatile blocks appearing too early in the assembled prompt:

- runtime wrappers
- reminders
- internal task completion events
- transient tool outputs
- metadata-heavy conversation envelopes

The system should optimize for **stable prefix reuse**, not generic prompt
compression.

## Provider-general model

Across major providers, prompt caching is still fundamentally a prefix problem,
but the routing and cache-control surfaces differ.

- Fireworks uses longest-prefix reuse and recommends static content first,
  dynamic content last, with optional session-affinity hints.
- OpenAI documents exact prefix matching and machine-local routing behavior.
- OpenRouter adds sticky routing on top of provider caches so that repeated
  requests from the same conversation are more likely to hit the same provider.
- Anthropic exposes prompt caching at content-block boundaries with
  `cache_control`, but still requires exact identity up to the cached boundary.

This means a harness-agnostic optimizer should assume:

1. exact prefix identity remains the central optimization target
2. provider routing locality matters
3. not every provider exposes the same cache-control granularity
4. transcript-wide reordering is only useful when it improves the effective
   reusable prefix for the provider-specific cache model

## Product shape

The repository is split into:

- a harness-agnostic optimizer core
- adapter packages that map harness-specific transcripts into the core
- telemetry and inspection tools for validating the effect in real sessions

## Design goals

1. Maximize exact prefix reuse.
2. Keep fixed prefix boundaries explicit.
3. Detect the first divergence deterministically.
4. Make block decisions confidence-aware.
5. Keep final prompt assembly deterministic.
6. Measure the effect with real-session telemetry.

## Non-goals

- freeform prompt rewriting
- transcript rewriting as a primary strategy
- generic summarization quality optimization
- provider-specific hacks baked into the core

## Core concepts

Detailed specs live in:

- [BLOCK-MODEL.md](./BLOCK-MODEL.md)
- [DECISION-POLICY.md](./DECISION-POLICY.md)
- [EVALUATION.md](./EVALUATION.md)

### Fixed prefix boundary

Some blocks should be outside the optimizer's discretion and always remain in
front:

- system/core policy
- stable tool inventory
- persistent workspace constraints

The optimizer should not "get smart" about these blocks. They define the stable
frontier that everything else must respect.

### First divergence

The core compares the previous prompt candidate and the current one block by
block. The first place where hashes differ defines the first divergence. That
point and a small window after it become the optimization target.

### Decision schema

The canonical decision model is defined in
[DECISION-POLICY.md](./DECISION-POLICY.md).

### Confidence-aware decisions

The intended decision stack is:

1. hard constraints
2. rule-based classification
3. heuristic scoring
4. statistical classifier
5. optional LLM arbiter for low-confidence cases

The LLM, when used, is a judge and not a rewriter.

## Assembly model

The final prompt should be assembled in deterministic layers:

1. fixed prefix
2. stable working prefix
3. active turn context
4. volatile suffix
5. optional summary/reference sidecars

The primary optimization mechanism is **moving volatile blocks later before the
prompt is sent**. Summary/reference sidecars are only a secondary mechanism for
preventing future churn after an unavoidable miss.

## Replay finding: append-only sessions change the problem

Real OpenClaw sessions exposed an important constraint:

- if the current prompt is already an append-only extension of the previous
  prompt, transcript-local reordering inside the newly appended tail usually
  cannot improve the current turn's cache reuse
- transcript-wide reordering can make things worse by moving previously stable
  suffix material ahead of the old append boundary

This means the optimizer must distinguish between:

1. **current-turn benefit**
   achievable only when the harness introduces volatility before the stable
   frontier or otherwise violates append-only growth
2. **future-turn churn reduction**
   useful after unavoidable misses, but not a way to save the current turn

Replay and evaluation should therefore model both worlds:

- baseline current-turn assembly
- maintenance-adjusted future turns after older injected context has been compacted

The runtime adapter therefore must never apply a reorder blindly. It should
only do so when replay semantics predict a strictly better stable prefix than
the baseline assembly.

## Telemetry model

The runtime should emit enough data to answer:

- where the first divergence occurred
- which block kind caused it
- which decisions were made
- how much cache-read was achieved
- which sessions are consuming the most prompt tokens

This telemetry is designed for real-session evaluation, not synthetic demos.

## OpenClaw adapter

The OpenClaw adapter is intentionally thin:

- normalize OpenClaw messages into core blocks
- feed them to the optimizer core
- emit telemetry
- expose adapter configuration

It should not own a separate policy model from the core.
