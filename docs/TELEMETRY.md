# Telemetry

The OpenClaw adapter emits JSONL telemetry so that prompt-stability decisions
can be evaluated against real sessions.

Two event families are emitted:

- assembly events
- post-turn usage events

Assembly events describe the block layout, divergence state, and runtime-policy
decision for the current turn. Post-turn events carry provider usage, including
prompt-cache usage where available.

## Core fields

- `timestamp`
- `engineId`
- `sessionId`
- `model`
- `estimatedChars`
- `blockCounts`
- `firstDivergence`
- `promptCache`
- `runtimePolicy`

## `firstDivergence`

When present, this describes where the assembled prompt first stopped matching
the previous prompt candidate.

Fields:

- `index`
- `previousId`
- `currentId`
- `previousKind`
- `currentKind`
- `previousHash`
- `currentHash`

This lets the inspector report divergence hotspots by block kind instead of
only saying that a break happened.

## `runtimePolicy`

Runtime policy is the key online signal. It captures whether the adapter
applied a runtime movement and why.

Fields may include:

- `applied`
- `reason`
- `firstDivergenceIndex`
- `moveStartIndex`
- `moveEndIndex`
- `movedStableIds`
- `baselinePrefixChars`
- `optimizedPrefixChars`
- `upliftChars`

Typical reasons include:

- `missing-previous-prefix`
- `append-only-growth`
- `divergence-not-pre-frontier-injected-volatility`
- `no-stable-suffix-after-injected-window`
- `predicted-no-uplift`
- `pre-frontier-injected-window`

## `promptCache`

When the runtime exposes prompt-cache usage, it appears here. The inspector uses
`promptCache.lastCallUsage` to calculate cache-read ratios by session.

Common fields:

- `input`
- `output`
- `cacheRead`
- `cacheWrite`
- `total`

## Example

```json
{
  "timestamp": "2026-04-13T01:23:45.000Z",
  "engineId": "stable-prefix-context",
  "sessionId": "agent:orchestrator:dev-thread",
  "model": "accounts/fireworks/models/qwen3p6-plus",
  "estimatedChars": 182341,
  "blockCounts": {
    "stable_user": 58,
    "assistant_turn": 82,
    "other": 29
  },
  "firstDivergence": {
    "index": 14,
    "currentId": "conversation-wrapper-3",
    "currentKind": "conversation_wrapper",
    "currentHash": "def"
  },
  "runtimePolicy": {
    "applied": false,
    "reason": "append-only-growth",
    "firstDivergenceIndex": 58,
    "baselinePrefixChars": 182341,
    "optimizedPrefixChars": 182341,
    "upliftChars": 0
  },
  "promptCache": {
    "lastCallUsage": {
      "input": 119335,
      "output": 273,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 119608
    }
  }
}
```

## Inspector

Use the inspector to summarize telemetry:

```bash
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl --session <session-id>
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl --json
```
