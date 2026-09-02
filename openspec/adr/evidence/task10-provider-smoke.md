# Task 10 provider smoke evidence

Date: 2026-07-28

## Scope

This evidence covers the remaining Task 10 item:

> Run focused real Codex and Claude Code smoke tests where available.

The smoke runner is [scripts/task10-provider-smoke.mjs](../../../scripts/task10-provider-smoke.mjs). It builds the current server-owned MCP stdio entry, starts an isolated local control socket, and permits only the read-only `list_terminals` operation. It does not use the application socket, real terminal data, write operations, or a network port.

## Capability detection

- Codex CLI: installed at `/Users/mark/.nvm/versions/node/v24.14.0/bin/codex`, version `codex-cli 0.145.0`; `codex login status` reported an authenticated ChatGPT session.
- Claude Code: installed at `/Users/mark/.local/bin/claude`, version `2.1.220`; `claude auth status` reported `loggedIn: false` and `authMethod: none`.

## Results

- Direct server-owned MCP probe: **passed**. `list_terminals` returned the isolated fixture terminal `Task 10 smoke terminal` through the released `apps/terminay-server/dist/mcpEntry.js` artifact and local control socket. The smoke intentionally builds that artifact rather than bundling `mcpEntry.ts` into a temporary directory, because the entry validates the release-integrity manifest beside the real artifact.
- Real Codex invocation: **passed**. Codex `0.145.0` discovered and completed `terminay.list_terminals`, then returned the exact fixture terminal name `Task 10 smoke terminal`. The MCP tool advertises truthful read-only, non-destructive, local-only annotations, allowing the non-interactive Codex invocation to make this bounded call without approval elevation.
- Real Claude Code invocation: **skipped** because the installed CLI is not authenticated. No Claude model/API request was made.

The Task 10 provider-smoke checklist item is complete: the available authenticated provider passed against the released stdio artifact, while the unavailable provider was skipped explicitly rather than treated as a pass.
