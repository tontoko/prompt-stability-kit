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
  Normalize OpenClaw messages into blocks, apply the narrow runtime policy only
  when the current turn diverges before the append boundary with injected
  volatility, and emit prompt-assembly telemetry.
- `afterTurn()`
  Emit provider usage and prompt-cache telemetry after the turn completes.
- `compact()`
  Delegate to the OpenClaw runtime compactor.

The adapter does not perform transcript rewriting. Its runtime policy is
limited to pre-frontier injected volatility, requires explicit sliceability, and
keeps append-only turns as a pass-through.

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
          "runtimePolicyMode": "pre-frontier-injected-only",
          "preFrontierInjectedWindowBlocks": 3,
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
- `runtimePolicyMode`
  Runtime policy mode. `pre-frontier-injected-only` is the safe default and
  only acts when divergence appears before the append boundary.
- `preFrontierInjectedWindowBlocks`
  Maximum contiguous injected-volatility blocks moved by the runtime policy.
- `minConfidenceToReorder`
  Legacy compatibility field retained for old configs. The current runtime
  policy does not perform confidence-based transcript-wide reordering.
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
5. validate candidate policies with `prompt-stability-replay`

Example:

```bash
openclaw gateway restart
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl --top 10
prompt-stability-replay ~/.openclaw/agents/orchestrator/sessions/<session>.jsonl
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

## Runtime safety model

The adapter compares the current candidate against the **actual previously sent
order**, not merely the baseline transcript order.

Runtime movement is allowed only when all of the following are true:

1. divergence occurs before the prior append boundary
2. the divergent window is injected volatility
3. the affected spans are explicitly sliceable and losslessly movable
4. predicted optimized prefix chars are strictly greater than baseline prefix
   chars

If any condition fails, runtime assembly is a no-op.
