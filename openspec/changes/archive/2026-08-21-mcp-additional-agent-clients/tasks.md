## 1. Provider adapters

- [x] 1.1 Add provider-specific adapters for Cursor CLI's user `mcp.json`, Gemini
  CLI's user `settings.json`, and OpenCode's user configuration, verified by the
  focused provider tests
- [x] 1.2 Preserve unrelated configuration, use atomic writes, reject malformed or
  unsupported configuration, and refuse to replace or remove a changed `terminay`
  entry, verified by the unrelated-configuration and changed-entry tests
- [x] 1.3 Resolve OpenCode's supported `.json`/`.jsonc` user configuration
  candidates deterministically and report ambiguous or unsafe-to-round-trip input
  without mutation, verified by the OpenCode candidate-resolution tests

## 2. Registry and UI

- [x] 2.1 Extend the server-owned provider registry, shared IPC union, and install
  modal copy to list and operate all five clients independently, verified by the
  install modal rendering one row per client with independent actions

## 3. Verification

- [x] 3.1 Add focused provider tests covering missing files, exact entries,
  idempotence, changed entries, malformed input, unrelated configuration, and
  independent status/action routing, verified by those tests passing
- [x] 3.2 Run the focused MCP install tests and the typecheck/build checks, and run
  Electron E2E only through `npm run test:e2e` where the UI journey requires it

## 4. Acceptance

- [x] 4.1 Cursor CLI is registered as `mcpServers.terminay` in `~/.cursor/mcp.json`
  with the packaged stdio command, arguments, and any required launch environment
- [x] 4.2 Gemini CLI is registered as `mcpServers.terminay` in
  `~/.gemini/settings.json` without setting `trust` or altering allow/exclude policy
- [x] 4.3 OpenCode is registered as the stable `mcp.terminay` local server with one
  command array and no permission override; an incompatible schema is reported for
  review rather than rewritten
- [x] 4.4 Detection distinguishes exact, absent, changed, and unavailable entries
  for every added client
- [x] 4.5 Install and uninstall are idempotent and cannot overwrite or delete a
  changed entry
- [x] 4.6 Every provider row reports its actual user-level configuration path and
  one row's operation cannot mutate another provider's file or state
- [x] 4.7 Existing Claude Code and Codex behaviour remains covered and unchanged
