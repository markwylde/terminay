## Why

Terminay bots have a minimal desktop and a separate agent execution stack from Atlas. Users need the same capable desktop, creative applications, and native CLI behaviour while retaining Terminay's public, locally built installation and per-bot ownership.

## What Changes

- Copy and adapt the relevant Atlas CLI runner, stream parsers, XFCE desktop session, desktop-control service/MCP, browser integration, and ArtCraft installer into Terminay-owned source. There is no import, package, checkout, registry, or runtime dependency on Atlas; Atlas itself is unchanged.
- **BREAKING** Replace the bots' ACP execution/declarations with host-owned native CLI drivers for Codex and Claude Code. Preserve stable built-in agent ids, profiles, model selection, per-bot sign-in, diagnostic history, explicit message posting, concurrent coordination, cancellation, and restart interruption semantics. Contributions declare a supported driver rather than an ACP executable.
- Preserve Claude's Ask me mode with a verified native control channel; Codex remains Autonomous only. A CLI capability mismatch blocks release rather than silently weakening approvals.
- Provide the Atlas-style XFCE application menu, taskbar, terminal, persistent Chromium profile/downloads, thirteen pinned ArtCraft applications, and whole-desktop screenshot/window/input tools plus browser tools attached to that same browser.
- Keep one persistent Terminay container/home per bot, local Docker-compatible socket transport, supervisor-confirmed process cleanup, protected desktop relay, resource controls, and attributed shared-engine access.
- Build the image locally from shipped source and public upstream dependencies, pin native CLI/application versions, include every input in image fingerprinting, and retain the last successful image on failure.
- Replace the large image-building panel with a single-line clickable status banner and a dedicated build-progress page: readable timeline steps, green completed ticks, amber active indicators, red failure crosses, cached/pending states, and expandable logs. Progress comes from actual build events and survives page navigation/reconnect.
- Record a new ADR that supersedes ACP-specific decisions without changing accepted ADR files. Reconcile pending bot contracts that currently require ACP before these changes are archived.

## Capabilities

### New Capabilities

- `bot-cli-runtime`: host-owned native CLI executions, driver declarations, credential handling, model selection, approvals, bounded diagnostics, lifecycle and compatibility verification.
- `bot-image-build-progress`: compact build status and an accessible, live timeline of actual image-build steps, outcomes and logs.
- `bot-desktop`: shared XFCE desktop, creative application suite, persistent browser, execution-scoped desktop/browser tools, and public local image provisioning.

### Modified Capabilities

- `extension-platform`: bot contributions describe supported native drivers; the server owns their processes, protocol translation, credentials, coordination and UI.
- `builtin-agents-extension`: built-in Codex and Claude Code bot agents use exact native CLI versions and executable conformance tests.

Bot environment, message log and bot lifecycle contracts also exist in pending changes (`add-terminay-bots`, `bots-use-message-log`, socket/proxy and guided-login changes), rather than canonical specs. Preserve their non-ACP requirements and reconcile their affected text during implementation; do not create competing versions of those capabilities or rewrite completed history.

## Impact

Primarily `docker/terminay-bot/`, `packages/server-core/src/botService/`, `packages/extension-api/src/bots.ts`, built-in agent contributions/conformance tests, relevant protocol/client/UI types, packaging and bot E2E. The desktop/apps increase build/download size. Copied source is maintained independently and must contain no internal endpoints, proprietary service integrations, or Atlas-specific data model dependencies. Public build inputs and applicable redistribution notices are recorded with the copied subset.

The scope is the two existing bot agents and their desktop/browser tools. Gemini, Atlas's direct provider API loops, database/job/organization services, remote runners, and changes to ordinary terminal detection or project chat providers are outside this change.
