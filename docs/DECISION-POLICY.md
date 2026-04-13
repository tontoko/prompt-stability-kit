# Decision Policy

## Purpose

The decision policy determines what the optimizer may do with candidate spans
once a stable frontier and divergence point have been identified.

## Core distinction

The optimizer must distinguish between:

1. current-turn cache improvement
2. future-turn churn reduction

These are not the same.

If the current turn is append-only relative to the previous prompt,
transcript-local reordering inside the newly appended tail cannot improve the
current turn's cache hit. In that case the runtime optimizer must no-op.

## Runtime decisions

The runtime path supports only these actions:

- `prefix_required`
- `suffix_before_send`
- `drop_before_send`

`drop_before_send` is allowed only when a block is both provably non-semantic
and losslessly droppable under the adapter contract. In practice this should be
rare.

## Post-turn decisions

The post-turn or offline path may additionally classify spans as:

- `defer_to_summary_after_send`
- `artifact_or_reference_candidate`

These do not improve the current turn. They exist only to reduce future churn
after an unavoidable miss.

## Hard rules

### Rule 1: fixed frontier is inviolable

Blocks before the fixed frontier are always `prefix_required`.

### Rule 2: no current-turn reorder without predicted benefit

Runtime must not reorder if replay semantics predict
`optimizedPrefix <= baselinePrefix`.

### Rule 3: append-only implies runtime no-op

If the current baseline prompt is already an append-only extension of the
previous prompt, runtime reordering must no-op unless the harness explicitly
inserts volatility before the append boundary.

### Rule 4: no rewriting in the decision engine

The decision engine may classify, but it may not rewrite content.

### Rule 5: confidence gates movement

Any non-hard movement decision requires confidence above the configured
threshold. Low-confidence cases default to `prefix_required`.

## Decision sources

The intended stack is:

1. hard constraints
2. exact divergence/fingerprint checks
3. heuristic scoring
4. statistical classifier
5. optional LLM arbiter for low-confidence cases only

The LLM is a judge, never a rewriter.

## Confidence

Confidence reflects how safe it is to move a span without reducing current-turn
prefix reuse or breaking semantics.

Confidence must be conservative.

If confidence is below threshold:

- runtime falls back to `prefix_required`
- offline analysis may still record a future-only optimization candidate

## What the runtime should optimize

The runtime optimizer should prioritize only spans that satisfy both:

- losslessly movable before send
- likely to appear before the stable frontier or otherwise break append-only
  growth

This usually means harness-injected control material, not arbitrary historical
transcript content.
