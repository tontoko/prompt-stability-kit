# Telemetry

The adapter emits one JSON object per assemble cycle when `telemetryPath` is
configured.

Each event contains:

- session id
- model id
- estimated assembled chars
- prompt-cache observation
- block counts by kind
- first divergence index versus the previous assemble snapshot
- rewritten transcript entry count, when available

The event format is intentionally generic so the inspector CLI can summarize it
without importing OpenClaw internals.

Example:

```json
{
  "timestamp": "2026-04-12T00:00:00.000Z",
  "sessionId": "abc123",
  "engineId": "stable-prefix-context",
  "estimatedChars": 6421,
  "blockCounts": {
    "conversation_wrapper": 1,
    "assistant_turn": 3
  },
  "firstDivergence": {
    "index": 12,
    "previousHash": "abc",
    "currentHash": "def"
  },
  "promptCache": {
    "retention": "long",
    "observation": {
      "broke": true
    }
  }
}
```

