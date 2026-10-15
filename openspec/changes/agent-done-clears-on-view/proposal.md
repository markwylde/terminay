## Why

The green done indicator tells the user an agent worked while they were away
and its result is ready to read. Once they click or type in that terminal they
have seen it, and a plain terminal's green dot clears to grey at that moment.
An agent's does not: acknowledging it only marks it read, so the entry stays
`done` — green in the Agents pane, the dashboard Done column, and the home
overview — until the agent's next status snapshot happens to arrive and remap
it to `idle`. A hook-driven agent that sends no further snapshot stays `done`
until its next turn. The same interaction means two different things depending
on whether an agent owns the terminal.

## What Changes

- Acknowledging a terminal whose bound root agent is `done` returns that root
  to `idle` in the same revision, everywhere it is shown. Acknowledgement is
  the existing set of interactions: clicking the tab, clicking into the
  terminal, typing, terminal navigation, activating its agent row, or
  dismissing its notification.
- A root that becomes `done` on the terminal the user is already interacting
  with is acknowledged on arrival and so shows `idle`.
- `waiting`, `blocked`, and `working` are unchanged by acknowledgement: they
  describe something still true, not a result to read.
- A subagent's `done` is unchanged: it records a finished child, not a pending
  result.
- Agent tabs obey the tab-indicator settings plain tabs already obey. Today an
  agent's tab glyph, project badge, and header count ignore **Show indicator
  for active tabs**, **Show indicator for finished tabs**, and a terminal's own
  **Activity indicators** switch. They follow them, with agent `working` as
  active, `done` as finished, and `waiting`/`blocked` as attention. A pending
  MCP approval still always shows. The Agents pane is unaffected.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agent-status-and-sidebar`: acknowledging a `done` root returns it to
  `idle`; acknowledgement otherwise still leaves operational state alone; tab
  and header surfaces follow the tab-indicator settings.
- `terminal-activity-signals`: agent indicators share the fallback viewing rule
  and the tab-indicator settings.

## Impact

- `packages/server-core/src/activity/agentStore.ts` — `markAcknowledged` and
  `markTerminalAcknowledged`.
- `src/agentStatusStore.ts` — the renderer-side store's matching methods.
- `src/components/TerminalTab.tsx` and `src/workspace/workspaceInventory.ts`
  — apply the indicator-visibility predicate to agent states.
- Unit tests for both stores; the agent status E2E spec where it asserts an
  acknowledged entry remains `done`.
- No wire or API change: the entry shape and the acknowledge calls are the
  same; only the resulting state differs.
