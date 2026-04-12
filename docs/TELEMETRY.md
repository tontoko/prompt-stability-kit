# Telemetry

The OpenClaw adapter emits JSONL telemetry so that prompt-stability decisions
can be evaluated against real sessions.

Two event families are emitted:

- assembly events
- post-turn usage events

Assembly events describe the block layout and divergence state. Post-turn events
carry provider usage, including prompt-cache usage where available.

## Core fields

- `timestamp`
- `engineId`
- `sessionId`
- `model`
- `estimatedChars`
- `blockCounts`
- `decisionCounts`
- `firstDivergence`
- `promptCache`

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

## `decisionCounts`

The adapter records aggregate decision counts for the current assembly snapshot.
This is intended for real-session trend analysis, not per-block replay.

Current decision keys may include:

- `prefix_required`
- `suffix_ok`
- `summarize_ok`
- `drop_ok`

These counts describe how the optimizer redistributed blocks during assembly.

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
  "decisionCounts": {
    "prefix_required": 163,
    "suffix_ok": 6
  },
  "firstDivergence": {
    "index": 14,
    "currentId": "conversation-wrapper-3",
    "currentKind": "conversation_wrapper",
    "currentHash": "def"
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
