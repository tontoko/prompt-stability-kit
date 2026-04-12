# prompt-stability-kit

`prompt-stability-kit` is a public monorepo for cache-friendly prompt assembly.
It is built around a generic stable-prefix core plus an official OpenClaw
context-engine adapter.

The goal is not generic summarization. The goal is to maximize stable prompt
prefixes, shrink volatile wrappers, and make cache breakpoints observable.

## Packages

- `@tontoko/prompt-stability-core`
  Harness-agnostic classification, canonicalization, assembly planning, and
  divergence diagnostics.
- `@tontoko/openclaw-stable-prefix-context`
  Official OpenClaw context-engine adapter plugin built on the core package.
- `@tontoko/prompt-stability-inspector`
  CLI utilities for telemetry inspection and divergence summaries.

## Initial focus

The v0 focus is the wrapper churn that most often breaks prompt caches in
long-lived OpenClaw sessions:

- conversation metadata wrappers
- internal runtime context blocks
- scheduled reminders
- async exec notices

The adapter canonicalizes those payloads into shorter, deterministic forms and
emits telemetry that makes cache breaks inspectable turn by turn.

## Repository layout

```text
packages/
  core/                     generic stable-prefix policy engine
  openclaw-context-engine/  official OpenClaw adapter plugin
  inspector/                diagnostics CLI
docs/
  DESIGN.md
  OPENCLAW-ADAPTER.md
  TELEMETRY.md
```

## Development

```bash
npm install
npm run check
```

## Local OpenClaw install

This repo is intentionally laid out so the adapter can be installed directly
from the package directory:

```bash
openclaw plugins install -l ./packages/openclaw-context-engine
```

Then set:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "stable-prefix-context"
    },
    "entries": {
      "stable-prefix-context": {
        "enabled": true
      }
    }
  }
}
```

See [docs/OPENCLAW-ADAPTER.md](./docs/OPENCLAW-ADAPTER.md) for the full config
surface and telemetry settings.

