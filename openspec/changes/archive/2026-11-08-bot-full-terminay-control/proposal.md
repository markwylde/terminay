## Why

A bot with **Terminay MCP access** is meant to have the same control of Terminay that Pixel has. It doesn't. Every window tool (`get_layout`, `arrange_tabs`, `focus_tab`, `resize_pane` and the rest) fails for a bot with `renderer_unavailable`, because the bot was given no agent's client. Asked for a project with four terminals in a 2x2 grid, Codexia created the terminals and then told the user to arrange them by hand.

It also started that project in the home folder. No MCP tool tells an agent where the user keeps projects, although the server keeps its recent project folders for the start chooser.

## What Changes

- A bot execution gets an agent's client. It is the window that sent the bot its latest message, or else the most recently attached window. Every view tool then works for a bot as it does for Pixel.
- `open_terminal` from a bot is placed in that window when there is one, and still created when there isn't.
- New read-only tool `list_recent_folders` for workspace reach: the server's recent project folders, newest first. It is in the Projects and windows permission group.
- A bot with access is told in its session context that it has full Terminay control, which window its view tools act on, and to check the recent folders before creating a project. Pixel's instruction mentions `list_recent_folders` too.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-workspace-view`: the agent's client of a bot execution.
- `mcp-app-control`: `list_recent_folders`, and `create_project` guidance.

## Impact

- `packages/server-core`: `WorkspaceViewRelay.latest()`, the bot's latest message window in `BotService`, the composition's `targetFor`, the bot context note, Pixel's instruction.
- `apps/terminay-server`: the view adapter's bot handling, the new tool across stdio, dispatcher, control endpoint and app-control adapter.
- `electron/main.ts`: the adapter binding and approval summary.
- ADR-0102 supersedes parts of ADR-0100 and ADR-0066.
