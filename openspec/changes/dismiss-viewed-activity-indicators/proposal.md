## Why

A green finished indicator means "this terminal was busy and now it is done, and you have not looked at it yet." Red means the same for attention. Interacting with that terminal — clicking its tab, clicking into the xterm, or typing — is looking at it, so both the terminal underline and the project-tab count should go away. Switching to the project is not enough: the indicators stay until the user actually touches the terminal. Amber stays, because that terminal is still working. Today green (and often red) sticks on a terminal the user is already working in, and a project click must not be treated as that interaction.

## What Changes

- Interacting with a terminal — clicking its tab, clicking into it, or typing — acknowledges finished (green) and attention (red) activity. The terminal indicator and the project's activity count both clear.
- Activating a project, including clicking its tab or activity badge, SHALL NOT acknowledge that project's terminals.
- Amber working indicators are live state. They remain on an interacted terminal until the work ends.
- The same rule applies to fallback terminal activity and to canonical agent RAG on tabs: `done` and unread attention are unviewed signals; `working` is not.
- Structured completion on an already-focused terminal no longer leaves a finished indicator. The previous "eligible even when active" behaviour is withdrawn.
- No protocol, snapshot shape, or settings changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: interacting with a terminal (tab click, xterm click, or typing), including already interacting when work completes, acknowledges finished and attention fallback indicators; activating the project does not; working remains visible.
- `agent-status-and-sidebar`: tab RAG for `done` and unread attention dismisses when the user interacts with that terminal; `working` stays. Header and project aggregates already count only unacknowledged entries and keep that rule.
- `workspace-and-project-tabs`: the project-tab activity count stays when the user only activates the project, and hides when every counted terminal in that project has been interacted with.

## Impact

- Client fold-back in `src/App.tsx` must not treat "this project's Dockview panel is active" as viewing. It acknowledges claimed finished or attention only for a terminal the user has clicked or typed into during this visit.
- `src/terminalActivityStore.ts` marks working→idle as finished even when `focused: true`. Failing tests already exist in `scripts/terminal-activity-store.test.mjs`.
- `src/components/TerminalTab.tsx` renders agent `done` RAG regardless of `agentUnread`, so a viewed agent can keep a green glyph after acknowledgement.
- Existing e2e `active terminal tabs show only the finished activity status dot by default` encodes the withdrawn behaviour and must be replaced. New coverage lives in `e2e/terminal-signals.spec.ts`.
- Server `activity.acknowledge` / `agent.acknowledge` stay the acknowledgement authority. No reducer, protocol, or persistence change is required beyond the client calling acknowledge for the focused session when finished or attention arrives.
