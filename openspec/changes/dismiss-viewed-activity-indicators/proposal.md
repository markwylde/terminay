## Why

A green finished indicator means "this terminal was busy and now it is done, and you have not looked at it yet." Red means the same for attention. Focusing that terminal is looking at it, so both the terminal underline and the project-tab count should go away. Amber stays, because that terminal is still working. Today green (and often red) sticks on the focused tab — including when an agent finishes while you are already watching it — so the chrome keeps shouting about work you have already seen.

## What Changes

- Viewing a terminal — selecting its tab, focusing it, or already having it focused when work completes — acknowledges finished (green) and attention (red) activity. The terminal indicator and the project's activity count both clear.
- Amber working indicators are live state. They remain on a focused terminal until the work ends.
- The same rule applies to fallback terminal activity and to canonical agent RAG on tabs: `done` and unread attention are unviewed signals; `working` is not.
- Structured completion on an already-focused terminal no longer leaves a finished indicator. The previous "eligible even when active" behaviour is withdrawn.
- No protocol, snapshot shape, or settings changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: viewing, including already being focused at completion, acknowledges finished and attention fallback indicators; working remains visible.
- `agent-status-and-sidebar`: tab RAG for `done` and unread attention dismisses when the terminal is viewed; `working` stays. Header and project aggregates already count only unacknowledged entries and keep that rule.
- `workspace-and-project-tabs`: the project-tab activity count hides when every counted terminal in that project has been viewed.

## Impact

- Client fold-back in `src/App.tsx` currently re-acknowledges only unclaimed focused sessions; claimed structured and provider-backed completions on the focused tab stay unviewed.
- `src/terminalActivityStore.ts` marks working→idle as finished even when `focused: true`. Failing tests already exist in `scripts/terminal-activity-store.test.mjs`.
- `src/components/TerminalTab.tsx` renders agent `done` RAG regardless of `agentUnread`, so a viewed agent can keep a green glyph after acknowledgement.
- Existing e2e `active terminal tabs show only the finished activity status dot by default` encodes the withdrawn behaviour and must be replaced. New coverage lives in `e2e/terminal-signals.spec.ts`.
- Server `activity.acknowledge` / `agent.acknowledge` stay the acknowledgement authority. No reducer, protocol, or persistence change is required beyond the client calling acknowledge for the focused session when finished or attention arrives.
