# ADR-0103: MCP never moves the user's view implicitly

Status: accepted
Date: 2026-11-10

## Context

ADR-0070 lets an agent's view operations be applied by the client it is talking from. `create_project` used that channel as a side effect: after creating a project it asked the agent's client to show it. Pixel, bots and agents create projects while the user is working elsewhere, so the user's window jumped to a project they did not open and lost keyboard focus. Which project, Home section, folder and tab a client shows, and where focus sits, is the user's.

## Decision

1. **An MCP tool changes what a client shows only when changing the view is that tool's stated purpose**, or the caller passes an explicit focus option. These are the view tools: the tools of the MCP workspace view (`focus_project`, `focus_tab`, `focus_terminal`, `focus_home`, `select_folder`, `open_file`, `move_tab`, `resize_pane`, `arrange_tabs`, `close_tab` and the folder tools), `split_terminal`, `open_workspace_window`, and `open_terminal` with `focus: true`.
2. **Every other tool leaves every client's view and keyboard focus as they were.** A project, terminal or other item it creates appears in the background.
3. A tool that needs to know the view, such as choosing the window the agent is talking from, MAY read it, never change it.

## Consequences

- `create_project` creates its project in the background; an agent calls `focus_project` when the user asks to see it.
- A new tool that would change the view as a side effect needs an explicit opt-in parameter or must be a view tool by name.
