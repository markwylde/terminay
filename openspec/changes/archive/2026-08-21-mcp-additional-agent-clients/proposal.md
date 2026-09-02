## Why

Terminay's independent MCP registration management exposed only Claude Code and
Codex. Cursor CLI, Gemini CLI, and OpenCode have supported user-level MCP
configuration contracts that were neither detected nor managed, so users of those
agents had to register Terminay by hand.

## What Changes

- Add provider-specific registration adapters for Cursor CLI's user `mcp.json`,
  Gemini CLI's user `settings.json`, and OpenCode's user configuration.
- Preserve unrelated configuration, write atomically, reject malformed or
  unsupported configuration, and refuse to replace or remove a changed
  `terminay` entry.
- Resolve OpenCode's supported `.json`/`.jsonc` user configuration candidates
  deterministically and report ambiguous or unsafe-to-round-trip input for review
  instead of mutating it.
- Extend the server-owned provider registry, the shared IPC union, and the
  install modal so all five clients are listed and operated independently.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `mcp-server`: registration management covers five agent clients with
  per-provider user-wide contracts and per-provider status and action routing.

## Impact

The privileged MCP registration service and its provider registry, the shared IPC
type union, the install modal copy, and the focused provider test suite.
