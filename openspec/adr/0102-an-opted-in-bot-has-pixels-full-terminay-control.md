# ADR-0102: An opted-in bot has Pixel's full Terminay control, including the window and recent project folders

Status: accepted, supersedes ADR-0100 (in part) and ADR-0066 (in part)
Date: 2026-11-08
Supersedes: ADR-0100 (only as the mcp-workspace-view spec applied it: "a bot execution caller has no agent's client"; every decision of ADR-0100 continues). ADR-0066 (decision 3's clause "MCP capability tokens and extensions cannot reach it", only for the server's recent project folders; the directory browser stays out of MCP's reach)

## Context

ADR-0100 let a bot hold workspace Terminay MCP reach when its owner turns on **Terminay MCP access**. The owner asked for the same access Pixel has. The first build gave a bot no agent's client, so every window tool (get_layout, arrange_tabs, focus_tab, resize_pane and the rest) failed with `renderer_unavailable`. The owner then asked the bot for a project in a 2x2 grid, and it could create the terminals but not arrange them.

The owner restated the requirement on 2026-11-08: a bot with Terminay MCP access has full control of Terminay.

The same request showed a second gap. The bot started the new project in the home folder, because no MCP tool tells an agent where the user keeps projects. The server already keeps its recent project folders for the start chooser. ADR-0066 kept every root-choosing query away from MCP.

## Decision

1. **A bot execution has an agent's client.** It is the window connection that sent the bot its latest message, while that connection stays open. Otherwise it is the most recently attached window whose connection is not bound to one project. A bot run by a trigger, with nobody talking to it, therefore acts on the window the user most recently opened. With no window attached, view operations fail with `renderer_unavailable` as they do for any caller, and `open_terminal` still creates the terminal, placed nowhere.
2. **Workspace reach can read the recent project folders.** A new read-only tool, `list_recent_folders`, returns the server's recent project folders (path and last use), newest first, to workspace-reach callers only: Home terminals, Pixel and other workspace chats, and opted-in bots. It is in the Projects and windows permission group. Browsing directories, forgetting a recent folder and making the start choice stay out of MCP's reach, as ADR-0066 requires.
3. **An opted-in bot is told what it can do.** Its session context says it has the `terminay` tools, which window they act on, and to choose a new project's root from the recent folders.

## Consequences

- An opted-in bot can rearrange the window the user is looking at, including from a trigger run. This is what opting in means. Never Allow still binds it, and turning access off revokes it at once.
- The window a trigger run acts on is a heuristic: the most recently attached one. A user with several windows open can be surprised. Messaging the bot from a window makes that window its target.
- Recent project folder paths are now visible to workspace-reach agents. They already see every project's root through `list_projects`, so this adds the history of roots, not a new class of data.
