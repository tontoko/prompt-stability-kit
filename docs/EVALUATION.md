# Evaluation Spec

## Purpose

The evaluation system validates prompt-stability policies against real harness
logs before they are promoted to runtime.

## Principle

Real-session replay is the source of truth.

Synthetic examples are useful for unit tests but are not sufficient to justify
runtime prompt mutation.

Provider documentation is the second source of truth. Replay must be interpreted
in light of the provider's cache semantics:

- exact-prefix caches
- block-boundary caches
- sticky-routing/session-affinity behavior

An optimizer is only valid if its replay assumptions are compatible with the
provider model actually used in production.

## Inputs

The evaluator consumes:

- real session transcript logs
- real provider usage when available
- the baseline assembly model
- the candidate optimized assembly model

For OpenClaw this means session JSONL plus cache usage observations.

## Required metrics

### Baseline metrics

- `baselinePrefixChars`
- `baselineAppendOnly`
- `firstDivergence`

### Optimized metrics

- `optimizedPrefixChars`
- `optimizedAppendOnly`
- moved span count
- decision counts

### Real usage metrics

- `input`
- `cacheRead`
- `cacheReadRatio`
- severe break indicators when available

### Derived metrics

- `upliftChars = optimizedPrefixChars - baselinePrefixChars`
- `turnsWithPositiveUplift`
- `turnsWhereCurrentTurnReorderCannotHelp`
- `turnsWithPotentialCurrentTurnBenefit`

## Acceptance criteria

A runtime policy is promotable only if replay on representative real sessions
shows all of the following:

1. positive uplift on a meaningful portion of eligible turns
2. no systematic negative uplift on append-only sessions
3. no violation of lossless reconstruction invariants
4. no increase in user-facing corruption or message-structure breakage

## Negative findings are valid outcomes

Replay is allowed to falsify a design.

If replay shows that a policy produces zero positive uplift or large negative
uplift on real sessions, that result is success for the evaluator and failure
for the policy.

The correct response is to redesign the optimizer, not to weaken the evaluator.

## Runtime promotion policy

The runtime adapter should stay conservative until replay demonstrates positive
benefit on real sessions.

For the current OpenClaw adapter, this means:

- pass-through plus telemetry is acceptable
- transcript-wide reorder is not acceptable
- only targeted, proven, pre-frontier volatility handling should move into the
  runtime path

## Recommended evaluation workflow

1. collect representative sessions
2. run replay on baseline and candidate policy
3. inspect append-only rate
4. inspect uplift distribution
5. inspect worst negative cases
6. promote only the smallest policy that survives this process
