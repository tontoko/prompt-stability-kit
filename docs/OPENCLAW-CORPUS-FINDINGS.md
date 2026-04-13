# OpenClaw Corpus Findings

This document captures the main findings from replaying and inspecting real
OpenClaw session transcripts.

## Summary

The most important result is negative: transcript-wide reordering is not the
right runtime optimization surface for current-turn cache-hit improvement in
OpenClaw.

Across representative orchestrator sessions, the transcript is overwhelmingly
append-only. That means the prompt seen by the model is usually the previous
prompt plus newly appended tail content. Reordering transcript blocks in this
shape does not extend the reusable prefix for the current turn.

The runtime optimizer should therefore focus on **pre-frontier injected
volatility** rather than transcript-wide movement.

## Replay Findings

Representative sessions showed:

- append-only turns dominate
- current-turn transcript reorder uplift is effectively zero
- predicted prefix extension is zero even when the transcript contains many
  volatile blocks

This is why the runtime policy currently no-ops on append-only growth.

## Surface Findings

The dominant injected surfaces in real OpenClaw sessions are:

- `conversation_wrapper`
- `internal_runtime_event`
- `system_reminder`
- `async_exec_notice`
- `queued_messages`

The largest character budgets consistently come from:

1. `internal_runtime_event`
2. `conversation_wrapper`
3. `queued_messages`

These surfaces matter even when current-turn prefix reuse cannot improve,
because they still inflate uncached tail size and can increase future churn.

## Design Implications

The optimizer should be split conceptually into two planes:

### 1. Current-turn prefix optimizer

This plane should only act on:

- injected volatility that appears before the stable frontier
- blocks that are losslessly movable
- situations where a strict prefix-uplift prediction is positive

### 2. Future-turn churn reducer

This plane is where summary/reference style handling belongs. It does not rescue
the current turn. It exists to prevent unavoidable misses from polluting later
turns.

## OpenClaw-specific Implication

Most of the immediate wins now appear to live in the OpenClaw core itself:

- inbound metadata envelope size
- internal runtime event envelopes
- reminder/async boilerplate
- queue framing

These are better handled by core-side lossless compaction than by transcript
rewriting in the context engine.

## Tooling

Use these inspector commands when evaluating changes:

```bash
prompt-stability-replay ~/.openclaw/agents/orchestrator/sessions/<session>.jsonl
prompt-stability-surfaces ~/.openclaw/agents/orchestrator/sessions/<session>.jsonl
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl
```
