## Why

The provider union, foreground matcher, journal roots, drivers, fixtures, and UI
labels were closed over `codex` and `claude-code`, so a user-started interactive
`omp` process in a Terminay terminal could not appear in the Agents sidebar.

## What Changes

- Add `omp` to the agent provider union and every mirrored client and UI union,
  displayed as `omp`, replacing hardcoded Codex/Claude Code ternary labels with
  a provider map.
- Match foreground `omp` (and `oh-my-pi` where that argv appears), reusing the
  existing leave-shell discovery window so a `bun` wrapper can still begin
  discovery.
- Resolve OMP's sessions root from `~/.omp/agent/sessions` plus
  `PI_CODING_AGENT_DIR`, `OMP_PROFILE`, `PI_PROFILE`, and Linux XDG, with an
  `ompHome` test override.
- Bind the exact PTY to its session file through OMP's terminal-scoped
  breadcrumb, skipping the 256-byte physical `title` slot and requiring a
  logical `type: "session"` record with a stable id.
- Add an `(omp, 0.1)` driver mapping session, turn, tool, done, exit, and child
  records into the existing canonical agent model.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `agent-status-and-sidebar`: `omp` becomes a supported journal provider with
  its own root resolution, breadcrumb binding, and record mapping.

## Impact

`packages/server-core/src/activity/agentTypes.ts`, `agentService.ts`,
`agentJournal.ts`, `agentDrivers.ts`, the client provider unions in
`packages/client-core/src/agentStatus.ts` and `src/types/agentStatus.ts`, the
`SharedAgentRouteBody` and `AgentsSidebar` labels, and the agent driver,
journal, and fixture suites. No oh-my-pi source changes.
