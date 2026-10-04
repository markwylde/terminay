## Why

A macro step that waits for a terminal to go quiet, and the MCP `wait_for_idle` tool, can resolve while a coding agent in that terminal is still working. The wait counts only terminal output, and an agent can be busy for many seconds without printing anything — for example while it waits on a shell command it started — so a macro that says "press Enter once the terminal has been idle for 3 seconds" presses Enter in the middle of the agent's turn.

Terminay already knows, per terminal, whether a bound agent is working. The wait does not consult it.

## What Changes

- The terminal inactivity wait resolves only when the terminal has produced no output for the requested period **and** no agent bound to that terminal is `working`.
- An agent that is `waiting`, `blocked`, `done`, or `idle` does not hold the wait open, so a macro can still answer an approval prompt.
- A terminal with no bound agent behaves exactly as it does today: output alone decides.
- When a working agent stops working, the quiet period starts again from that moment.
- The macro "wait for inactivity" step, the MCP `wait_for_idle` tool, and the `terminal.wait-inactivity` protocol query all share this one definition. No new setting, step type, or tool parameter is added.

Decisions behind these points are recorded in `questionnaires/idle-definition.yaml`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: adds the requirement that defines canonical terminal inactivity as a quiet period combined with bound-agent state. The `macros` and `mcp-server` specs already refer to "inactivity waits" and "canonical terminal inactivity" without defining them, so their requirements do not change.

## Impact

- `packages/server-core/src/terminalService/` — the inactivity wait gains an optional hold source; `types.ts` gains its interface.
- `packages/server-core/src/composition.ts` — wires the agent status service in as that hold source.
- `packages/server-core/src/activity/` — a small adapter exposing "is an agent working in this terminal" and its change edges.
- No protocol, client, renderer, macro-definition, or MCP schema change. Callers in `electron/main.ts`, `electron/serverTerminalAuthority.ts`, and `apps/terminay-server/src/cli.ts` are unchanged.
- Behaviour change for existing macros and MCP callers: a wait in an agent terminal can now take longer than before, by design.
