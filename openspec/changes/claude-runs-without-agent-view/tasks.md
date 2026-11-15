## 1. Extension API

- [x] 1.1 Let an applying `TerminalCommandDefaultResolution` carry `args`, `environment`, or both, and add `isTerminalCommandDefaultEnvironment` with bounds in `EXTENSION_LIMITS`. Verified by `packages/extension-api` tests.

## 2. Server core

- [x] 2.1 Keep each default's environment in `TerminalCommandDefaultRegistry`, add `commandDefaultEnvironment` (contested names dropped), and keep environment-only defaults out of `TERMINAY_COMMAND_DEFAULTS`. Verified by new cases in `packages/server-core/test/command-defaults.test.mjs`.
- [x] 2.2 Set default environment on the integrated shell in `ShellIntegration.inject`, unless the launch environment already has the name. Verified by a new case in `packages/server-core/test/shell-integration.test.mjs`.
- [x] 2.3 Pass environment through the extension host's resolution validation. Verified by a new case in `packages/server-core/test/terminal-command-default-host.test.mjs`.

## 3. Built-in agents

- [x] 3.1 Add the `claude-no-agent-view` contribution under the Claude Code harness, and `createClaudeCommandDefault`, which probes `claude agents --json` with the variable set. Verified by new cases in `extensions/builtin-agents/test/command-defaults.test.mjs`.
- [x] 3.2 Check against the real Claude Code 2.1.325: the default resolves to `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, and an integrated bash built by `ShellIntegration` refuses `claude --bg`. Verified by running both on the development server.

## 4. Records

- [x] 4.1 Record ADR-0124, superseding ADR-0105, and index it. Verified by `openspec validate --all`.
- [ ] 4.2 After release, in a Terminay terminal, start Claude Code and try `claude --bg`. It is refused, and a working conversation lights its own tab. Verified by observation recorded in the PR.
