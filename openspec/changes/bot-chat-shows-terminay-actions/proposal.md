## Why

A bot with Terminay MCP access can create a project, open a terminal, run a command, attach a workflow, create an automation or set up one of its own triggers. None of that shows in its Chat. The user only learns what changed if the bot happens to mention it, and even then has to go and find the thing by hand (issue #599). Chat should show each thing the bot did to Terminay, in Terminay's own words, with a link to it.

The technical gap: Chat shows only messages a bot posts on purpose, and keeps tool use in execution details. Provider tool reports are not trustworthy enough to describe a Terminay change, and they do not know what the call created. The server, which runs each Terminay MCP call and each runtime trigger call for the bot, does.

## What Changes

- After a bot execution's Terminay MCP call that acts (creates, opens, runs, types, changes, moves, closes, deletes, focuses), the server records an **action entry** in that bot's message log, whether the call succeeded or failed. The recorded tools are an explicit list; reads, lists, searches, waits, connected-server tools and calling-terminal tools are not recorded.
- The bot's runtime trigger tools that change a trigger or run it (create, update, delete, enable/disable, run now) are recorded the same way.
- Descriptions and failure reasons are redacted like the bot's own posts. Recording happens after the tool has answered, so it never slows or fails the call, and an action whose chat was cleared mid-call is dropped.
- An action entry carries the tool, the execution, a short description in Terminay's own words (the same wording agent chats use for Terminay calls), whether it was done or failed with a short reason, and a link target when the call created or addressed something: a project, a terminal, an automation, a workflow template, one of the bot's triggers, or Settings.
- Repeated identical actions in a row (the same execution, tool, description, target and outcome, such as typing into one terminal five times) fold into one entry with a count. A bot keeps at most 2,000 action entries; older ones are dropped, never messages.
- Chat shows each action entry as one compact row in the message stream: a small icon, the description, a done or failed mark, a ×N count when folded, and a link such as **Open terminal** that reveals what it touched on the bot's server (or says it no longer exists). Consecutive rows sit together as one tight group; a group of more than three shows the latest three and an "N earlier actions" toggle.
- Action entries never raise a bot notification, never count as unread, never start an execution, cannot be edited, quoted or deleted on their own, are left out of execution briefings, and are removed by Clear chat.

Out of scope: showing provider-native tools (shell, desktop, browser) in Chat, actions of connected-server tools beyond a generic "Used <tool>" row, message threads (#604), and agent-chat rendering.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: modifies "Communication UI" so Terminay actions are the one kind of tool use shown in Chat; adds "Terminay actions in the message log", "Action entry content", "Action link targets", "Folding repeated actions", "Action entry storage", "Action entries are not posts", "Action rows in Chat" and "Action links".

## Impact

- `packages/protocol/src/botMessages.ts`: optional `activity` on `BotMessage` and its summary; `BotMessageActivity` and target types.
- `packages/server-core/src/botService/messages.ts`: `recordActivity` with in-place folding and a 2,000-entry cap; activity rows excluded from unacknowledged posts, edit/delete and the post history limit; validation on load.
- `packages/server-core/src/botService/service.ts`, `sessions.ts`, `runtime.ts`, `actionWording.ts` (new): `recordAction` (owner, epoch and redaction checks), trigger recording, wording, and actions kept out of briefing excerpts.
- `apps/terminay-server/src/mcp/host.ts` and `botActions.ts` (new): wraps the control dispatcher; for a bot execution capability, resolves the target to server IDs and records the action after the response.
- `packages/client-core/src/botMessages.ts`: validates activity, dropping malformed action rows.
- `src/workspace/bots/BotActionRow.tsx`, `botActions.ts` (new), `transcriptModel.ts`, `BotChat.tsx`, `BotTranscript.tsx`, `BotTab.tsx`, `src/App.tsx`: compact rows, grouping, links and unread exclusion.
- Navigation wiring from `BotTab` to existing project/terminal/automation/workflow/settings navigation.
- Tests: server unit tests for recording, folding, exclusions and target resolution; a client model test for grouping; `e2e/bots.spec.ts` coverage and screenshots.
- No new privilege: links only reveal things through existing navigation; the client gets no new MCP or host capability.
