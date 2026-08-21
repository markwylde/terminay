# MCP registration for Cursor CLI, Gemini CLI, and OpenCode

## Goal

Extend the independent Terminay MCP registration management specified in
[mcp-server.md](../features/mcp-server.md) to Cursor CLI, Gemini CLI, and
OpenCode.

## Current gap

The privileged registration service, shared IPC types, install modal, and
focused tests currently expose only Claude Code and Codex. The additional
clients' supported user-level configuration contracts are not detected or
managed.

## Scope

- [x] Add provider-specific adapters for Cursor CLI's user `mcp.json`, Gemini
  CLI's user `settings.json`, and OpenCode's user configuration.
- [x] Preserve unrelated configuration, use atomic writes, reject malformed or
  unsupported configuration, and refuse to replace or remove a changed
  `terminay` entry.
- [x] Resolve OpenCode's supported `.json`/`.jsonc` user configuration candidates
  deterministically and report ambiguous or unsafe-to-round-trip input without
  mutation.
- [x] Extend the server-owned provider registry, shared IPC union, and install
  modal copy to list and operate all five clients independently.
- [x] Add focused provider tests covering missing files, exact entries,
  idempotence, changed entries, malformed input, unrelated configuration, and
  independent status/action routing.
- [x] Run the focused MCP install tests, typecheck/build checks, and Electron E2E
  only through `npm run test:e2e` if the UI journey requires E2E coverage.

## Acceptance checks

- [x] Cursor CLI is registered as `mcpServers.terminay` in
  `~/.cursor/mcp.json` with the packaged stdio command, arguments, and any
  required launch environment.
- [x] Gemini CLI is registered as `mcpServers.terminay` in
  `~/.gemini/settings.json` without setting `trust` or altering allow/exclude
  policy.
- [x] OpenCode is registered as the stable `mcp.terminay` local server with one
  command array and no permission override; an incompatible schema is reported
  for review rather than rewritten.
- [x] Detection distinguishes exact, absent, changed, and unavailable entries
  for every added client.
- [x] Install and uninstall are idempotent and cannot overwrite or delete a
  changed entry.
- [x] Every provider row reports its actual user-level configuration path and
  one row's operation cannot mutate another provider's file or state.
- [x] Existing Claude Code and Codex behavior remains covered and unchanged.

## Definition of done

The feature specification describes all five supported clients, the additional
adapters and UI are implemented through the privileged MCP installation
service, focused tests pass, and this task is moved to `tasks_completed/` with
its checklist complete.
