# prompt-stability-kit

`prompt-stability-kit` is a monorepo for improving prompt-cache hit rates in
agent harnesses.

It has two parts:

- `@tontoko/prompt-stability-core`
  A harness-agnostic stable-prefix optimizer core.
- `@tontoko/openclaw-stable-prefix-context`
  The official OpenClaw adapter built on top of the core.

The repository is not a generic summarization toolkit. Its purpose is narrower:

- detect where prompt prefixes start diverging
- decide what must stay in the fixed prefix
- move volatile blocks later when safe
- keep assembly deterministic
- measure the effect with real telemetry

## Architecture

The target architecture is:

1. Normalize harness messages into stable blocks.
2. Compare the previous and current prompt candidates block by block.
3. Detect the first divergence and inspect the surrounding window.
4. Classify candidate blocks with confidence-aware decisions.
5. Reorder blocks deterministically around fixed prefix boundaries.
6. Emit telemetry that can be inspected against real sessions.

The key design principle is that cache-hit optimization is primarily a
**placement problem**, not a rewriting problem. The optimizer tries to preserve
exact prefix identity for as long as possible.

See [docs/DESIGN.md](./docs/DESIGN.md) for the full design.

## Repository layout

```text
packages/
  core/                     stable-prefix optimizer core
  openclaw-context-engine/  official OpenClaw adapter
  inspector/                telemetry CLI for real-session analysis
docs/
  DESIGN.md
  OPENCLAW-ADAPTER.md
  TELEMETRY.md
```

## Packages

### `@tontoko/prompt-stability-core`

The core owns:

- block normalization contracts
- fixed-prefix boundaries
- first-divergence detection
- confidence-aware decision schema
- deterministic ordering plans
- telemetry types shared across adapters

The core does not own:

- transcript persistence
- harness lifecycle hooks
- provider SDKs

### `@tontoko/openclaw-stable-prefix-context`

The OpenClaw adapter owns:

- OpenClaw context-engine registration
- message normalization into core blocks
- adapter-specific telemetry wiring
- adapter-specific install and runtime configuration

The adapter does not redefine the core policy model. It is intentionally thin.

### `@tontoko/prompt-stability-inspector`

The inspector is a CLI for real-session validation. It summarizes:

- cache-read ratios by session
- divergence hotspots
- decision counts
- sessions consuming the most prompt tokens

## Inspector usage

```bash
prompt-stability-inspector ~/.openclaw/logs/context-engine/stable-prefix.jsonl
```

Useful options:

```bash
prompt-stability-inspector telemetry.jsonl --top 10
prompt-stability-inspector telemetry.jsonl --session <session-id>
prompt-stability-inspector telemetry.jsonl --json
```

## OpenClaw install

Install the adapter from a local checkout:

```bash
openclaw plugins install -l ./packages/openclaw-context-engine
```

Then enable it in `~/.openclaw/openclaw.json`:

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
          "telemetryPath": "~/.openclaw/logs/context-engine/stable-prefix.jsonl"
        }
      }
    }
  }
}
```

See [docs/OPENCLAW-ADAPTER.md](./docs/OPENCLAW-ADAPTER.md) for the adapter
contract and [docs/TELEMETRY.md](./docs/TELEMETRY.md) for the telemetry format.

## Development

```bash
npm install
npm run check
```
