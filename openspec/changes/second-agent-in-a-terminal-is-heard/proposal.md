## Why

Once one agent chat has run in a terminal, every later chat in that terminal
is ignored by the terminal's activity. The server keeps the first chat's
identity on the terminal for good and drops any update that names another, so
the terminal reads as idle while the second chat works, and its finished,
waiting, and blocked states raise no indicator, no Dock badge, and no
notification on any device. Starting a new chat, clearing one, or launching
the agent again each make a different chat, so in ordinary use a terminal
stops notifying after its first.

## What Changes

- Another agent's update takes a terminal over once the agent that holds it
  has finished or gone idle.
- An agent that is still working, waiting, or blocked keeps its terminal:
  another agent's update is still dropped then, as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: states when a terminal's activity passes from
  one agent to another.

## Impact

- `packages/server-core/src/activity/reducer.ts` — the identity fence in
  `applyProviderActivity`.
- `packages/server-core/test/activity-reducer.test.mjs`.
