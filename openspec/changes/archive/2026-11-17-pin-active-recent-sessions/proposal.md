## Why

A bot's Chat context rail lists its recent sessions newest first and shows only six. When a bot has a long-running or waiting session and newer sessions finish after it starts, the live session slides down the list or off it entirely, so the user loses the one row they can still act on (open it, answer it, or stop it). Issue #620 asks for active sessions to be pinned to the top of the recent sessions.

A second, technical cause makes this worse: the client keeps only the 20 newest sessions per bot, so an active session older than those is dropped from every client view, not just the rail.

## What Changes

- The context rail's **Recent sessions** list shows active sessions first, then inactive ones; each group keeps newest-first order. The six-row cap applies after pinning, so an active session is never pushed out by newer finished ones.
- "Active" means a session that is **queued**, **running**, or **needs you** — the states the rail already offers Stop for, and the states the chat counts as active. Suspended sessions (agent closed, resumable) and ended sessions are inactive.
- Active rows show a pulsing state dot (the existing bot "working" pulse, off under reduced motion) alongside the existing state label and Stop button, so pinned rows read as live.
- The client's per-bot session projection keeps every active session in addition to the 20 newest, so an old active session is not lost before the rail can pin it.

Interpretation recorded: issue #620 has no body. "Recent sessions" is read as the bot Chat context rail's **Recent sessions** section (the only UI with that name); the Configure → Sessions tab is a full, filterable history and keeps its newest-first order.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `terminay-bots`: adds a requirement that the context rail's recent sessions pin active sessions above inactive ones.

## Impact

- `src/workspace/bots/botsModel.ts` — active-state predicate and recent-session ordering helper.
- `src/workspace/bots/BotContextRail.tsx`, `botPanels.css` — ordering and active dot styling.
- `src/workspace/bots/useServerBots.ts` — projection retention of active sessions.
- Unit tests in `botsModel.test.ts`; E2E coverage in `e2e/bots.spec.ts`.
- No protocol, server, or privilege change.
