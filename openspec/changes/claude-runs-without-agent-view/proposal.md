## Why

A Claude Code conversation in a Terminay terminal can show as **Working** in
the Agents pane while its tab says idle. The Agents pane marks it **External**,
and the tab never lights. This happens whenever Claude Code uses its agent view:
the conversation runs under Claude Code's on-demand daemon, on a
pseudo-terminal of its own, so it no longer shares the tab's controlling
terminal and the binding rule treats it as external. A plain `claude` that
stays in the foreground binds normally, which is why the bug looks
intermittent.

Codex had the same problem and is fixed by the `codex` → `--no-daemon` command
default (ADR-0081). Claude Code has no such flag. Its documented switch is the
`CLAUDE_CODE_DISABLE_AGENT_VIEW=1` environment variable, which command defaults
cannot set today.

## What Changes

- A terminal command default's resolution may add environment variables as
  well as flags. Terminay sets them on the shell it starts with integration,
  unless the shell already inherits that variable.
- The built-in agents extension contributes a `claude` command default under the
  Claude Code harness that sets `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, once the
  installed Claude Code proves it honours the variable.
- ADR-0124 records the owner-approved widening of command defaults and the new
  default, superseding ADR-0105.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `extension-platform`: a command default's resolution may report environment.
- `builtin-agents-extension`: the `claude` command default.
- `shell-profiles-and-terminal-launch`: an integrated shell carries the
  environment of applying command defaults.

## Impact

- Code: `packages/extension-api/src/terminals.ts`, `constants.ts`;
  `packages/server-core/src/terminalService/commandDefaults.ts`,
  `shellIntegration.ts`; `extensions/builtin-agents/src/commandDefaults.ts`,
  `index.ts`, `package.json`.
- Users: inside Terminay terminals, Claude Code's agent view (`claude agents`,
  `--bg`, `/background`) is off while the Claude Code harness is on.
