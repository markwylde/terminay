## Context

View operations reach a client through `WorkspaceViewRelay`, addressed by `targetFor(caller)`. Terminals use their presentation-lease holder. Chats use the connection that sent their latest message, held by `AgentChatService`. `requestAgentView` refused any bot caller outright.

## Goals / Non-Goals

**Goals:** every Terminay MCP tool a workspace chat can use works for an opted-in bot, and an agent can see where the user keeps projects.

**Non-Goals:** `show_window` for bots (chats can't use it either: an app window belongs to a calling terminal), or browsing server folders over MCP.

## Decisions

- **Bot target.** `BotService` records `{clientId, connectionId}` when `bots.messages.post` succeeds, and forgets it when the connection closes. `targetFor({botId})` returns that viewer while the relay still has the connection. Otherwise it returns `WorkspaceViewRelay.latest()`, the most recently attached connection not bound to one project. Re-attaching moves a connection to the end. *Alternative:* fail when the bot has no viewer, as chats do. Rejected because trigger runs have no viewer, and the owner wants full control.
- **Placement.** `anchorFor` asks a bot's client for its layout like a chat's. If there is no client, it places nothing instead of failing, so `open_terminal` still works headless.
- **Recent folders.** The app-control adapter reads `state.recentProjectFolders` straight from workspace state, sorted newest first, so no new server operation is exposed. Workspace reach only.
- **Context.** `BotMemories.context` appends a Terminay note when `terminayMcpAccess` is on.

## Risks / Trade-offs

- A trigger run may rearrange whichever window was attached last. Messaging the bot from a window pins that window.
