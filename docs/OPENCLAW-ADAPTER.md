# OpenClaw adapter

## Package

`@tontoko/openclaw-stable-prefix-context`

Registered context-engine id:

- `stable-prefix-context`

## Behavior

The adapter focuses on wrapper normalization, transcript maintenance, and
telemetry. It does not replace OpenClaw's built-in compaction algorithm.

- `ownsCompaction: false`
- `compact()` delegates to `delegateCompactionToRuntime(...)`
- `assemble()` canonicalizes volatile wrapper messages
- `maintain()` rewrites older transcript entries into canonical form

## Config

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "stable-prefix-context"
    },
    "entries": {
      "stable-prefix-context": {
        "enabled": true,
        "telemetryPath": "~/.openclaw/logs/context-engine/stable-prefix.jsonl",
        "dedupeControlMessages": true,
        "rewriteTranscript": true,
        "maxInternalContextChars": 800,
        "maxConversationWrapperBodyChars": 1600
      }
    }
  }
}
```

### Config fields

- `telemetryPath`
  Optional JSONL sink path. If omitted, telemetry is disabled.
- `dedupeControlMessages`
  When enabled, repeated canonical control messages are collapsed.
- `rewriteTranscript`
  When enabled, `maintain()` asks the runtime to replace older wrapper-heavy
  transcript entries with canonicalized forms.
- `maxInternalContextChars`
  Upper bound for retained internal context detail.
- `maxConversationWrapperBodyChars`
  Upper bound for retained conversation body text.

## Install from local checkout

```bash
openclaw plugins install -l ./packages/openclaw-context-engine
```

## Switching back

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "legacy"
    }
  }
}
```

