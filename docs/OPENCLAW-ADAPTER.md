# OpenClaw adapter

## Package

`@tontoko/openclaw-stable-prefix-context`

Registered context-engine id:

- `stable-prefix-context`

## Role in the architecture

The adapter is the OpenClaw-specific shell around the generic optimizer core.
Its responsibilities are:

- normalize OpenClaw messages into core blocks
- invoke the core assembly plan
- expose adapter configuration
- emit telemetry for real-session evaluation

The adapter is not intended to become a second policy engine. Prefix-stability
decisions belong in the core package.

## Runtime behavior

Current runtime responsibilities:

- `assemble()`
  Normalize OpenClaw messages into blocks, compute an optimization plan, reorder
  blocks deterministically, and emit prompt-assembly telemetry.
- `afterTurn()`
  Emit provider usage and prompt-cache telemetry after the turn completes.
- `compact()`
  Delegate to the OpenClaw runtime compactor.

The adapter does not perform transcript rewriting. Its job is to expose the
core optimizer inside OpenClaw and make the resulting behavior observable in
real development sessions.

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
        "config": {
          "telemetryPath": "~/.openclaw/logs/context-engine/stable-prefix.jsonl",
          "dedupeControlMessages": true,
          "largeBlockChars": 1200,
          "minConfidenceToReorder": 0.2,
          "maxInternalContextChars": 800,
          "maxConversationWrapperBodyChars": 1600
        }
      }
    }
  }
}
```

### Fields

- `telemetryPath`
  Optional JSONL sink for prompt-stability telemetry.
- `dedupeControlMessages`
  Whether exact duplicate control messages should be collapsed during assembly.
- `largeBlockChars`
  Size threshold that increases the likelihood of a block being treated as a
  `summarize_ok` candidate by the decision engine.
- `minConfidenceToReorder`
  Minimum confidence required before a non-fixed block is moved out of the
  working prefix.
- `maxInternalContextChars`
  Telemetry-only hint for very large internal-context blocks.
- `maxConversationWrapperBodyChars`
  Telemetry-only hint for very large conversation-wrapper bodies.

## Install from local checkout

```bash
openclaw plugins install -l ./packages/openclaw-context-engine
```

## Validation flow

Recommended validation loop:

1. enable the adapter
2. restart the gateway
3. run real work in OpenClaw
4. inspect the emitted telemetry with `prompt-stability-inspector`

Example:

```bash
openclaw gateway restart
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl --top 10
```

## Switching back to the legacy engine

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "legacy"
    }
  }
}
```
