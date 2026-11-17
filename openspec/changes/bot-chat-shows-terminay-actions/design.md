## Context

A bot execution reaches Terminay through two server-owned surfaces:

- **Terminay MCP** (ADR-0100). The bot service opens a relay per execution in `apps/terminay-server/src/mcp/botTerminayMcp.ts`. Each relayed call reaches the control endpoint (`controlEndpoint.ts`) with a capability whose resolved scope carries `bot: { botId, executionId }`, and runs through the dispatcher built by `createTerminalControlAdapter` in `host.ts`: reach check, permission gate, handler. A dispatcher result is a bare value, `{ ok: true, result, modelContext? }` or `{ ok: false, error }`; handlers may also throw.
- **Runtime trigger tools** (ADR-0093). `callTriggerTool` in `packages/server-core/src/botService/runtimeTriggers.ts`, reached from `BotRuntime.call` in `runtime.ts` with a live execution. `BotRuntime.call` routes `triggers_create|update|delete|enable|run` (and the read tools); `triggers_reset` and `triggers_retry` are declared but not routed, so they are out of scope here.

The message log (`BotMessageStore`, `messages.ts`) holds durable rows with sequence, revision, history rows for snapshot pagination, change events and an epoch that Clear chat replaces. Chat (`BotChat.tsx`) turns messages into transcript items, and `BotTranscript.tsx` turns items into blocks and inserts the unread divider. Agent chats already describe each Terminay call in Terminay's words (`describeChatMcpCall`), but only from the permission gate, with no outcome and no target.

Boundaries crossed: the MCP control boundary (bot execution capability → bot service), and the renderer navigation boundary (a chat row asks the workspace to reveal something). Neither adds authority. The recorder sees only calls the bot was already allowed to make, and links use navigation every user already has.

## Goals / Non-Goals

**Goals:** a durable, server-authored, compact record of what a bot did to Terminay, with outcome and a link; no agent-supplied text deciding what a link points at; no notification noise; no added latency on the tool; minimal surface in `BotChat.tsx`, because issue #604 is changing it in parallel.

**Non-Goals:** provider-native tool use; live "in progress" rows; connected-server tools (`call_connected_tool`), calling-terminal tools (`show_window`, `close_window`, `send_notification`, `dismiss_notification`), which are not recorded; `triggers_reset`/`triggers_retry` routing; agent-chat changes; selecting one trigger inside Configure, for which no view exists.

## Decisions

### 1. Record after dispatch, in the host, from the capability's bot principal
`host.ts` wraps the dispatcher passed to `createControlEndpoint` with `withBotActions(dispatch, deps)` (new `apps/terminay-server/src/mcp/botActions.ts`). For a call with `context.bot` whose op is in `BOT_ACTION_OPERATIONS` (the exact list in the spec), it:

1. reads the bot's message-log epoch, and resolves the addressed terminal (`params.terminal` → session ID, with `resolveMcpTerminal`) or project (`params.project` handle → project ID, with `mcpProjectHandles.resolve`), swallowing resolution errors. This happens before dispatch, so close, rename and move see the original;
2. awaits the dispatch and normalizes its result: `{ ok: false, error }` or a throw is `failed`, with reason `<code>: <message>`; anything else is `done`, with `result` unwrapped from `{ ok: true, result }`;
3. completes the target after dispatch. A terminal target looks up the session's *current* project, so a moved terminal links to its new project; a session that no longer exists drops the target. Result targets are read from the normalized result: `create_project` → `result.project` handle, `open_terminal`/`split_terminal` → `result.terminal`, `create_automation` → `result.automation.id`, `create_workflow_template` → `result.template.id`;
4. returns the dispatch result unchanged, then records with `setImmediate`, outside the tool's response path. Errors are logged.

Bot callers never wait on an approval (mcp-permissions "Bot execution callers do not prompt"), so the gap between pre-dispatch resolution and the handler's own resolution is microseconds. A session ID is stable, and a title reference could only differ if the title changed in that gap. The handler stays authoritative; the link is the terminal the reference named when the call began.

Refusals the endpoint raises before dispatch (invalid or revoked capability, scope) never reach the wrapper. Refusals inside the dispatcher (reach, permission policy, `unsupported_op`, validation, handler errors) are recorded as failed. The outcome is the handler's, even if the endpoint's deadline already answered the caller.

Alternatives: noting from the permission gate, as agent chats do, was rejected because it has no outcome or created ID. Parsing provider tool reports was rejected because they are untrusted, provider-specific and blind to results.

### 2. `BotService.recordAction` checks owner, redacts, and respects the epoch
`recordAction(botId, executionId, action, epoch)` records only when `sessions.botOf(executionId) === botId` (a new no-copy lookup) and the log's epoch still equals `epoch`, so an action whose call straddled Clear chat is dropped. It redacts `text` and `reason` with `redactMessage` (as `postBotMessage` does) before the store cuts them. If redaction throws, nothing is recorded. Trigger actions are recorded the same way from `BotRuntime.recordingTriggerAction` around `callTriggerTool`. Done actions link to `result.trigger.id` or the validated `triggerId`, and delete links to nothing. A failed action links only if `triggerId` is one of the bot's current triggers.

### 3. Wording: past tense for done, "Couldn't …" for failed
`packages/server-core/src/botService/actionWording.ts` maps each recorded op to a verb and its object, for example `create` + `the project “api”`, `run` + `` `npm test` in the terminal “api” ``, or `type into` + `the terminal “api”`. A done action uses the verb's past form ("Created the project “api”"); a failed one reads "Couldn't create the project “api”". Names are cut to 60 characters and commands to 80, with whitespace collapsed. Terminals use their displayed title and projects their name. Settings show key *names* only. The store cuts the text to 512 bytes and the reason to 200, on UTF-8 boundaries.

### 4. Storage: an action is a message row with `activity`
`BotMessage` gains optional `activity: BotMessageActivity` (`tool`, `outcome`, `reason?`, `target?`, `count`), and `text` holds the description. `BotMessageStore.recordActivity`:

- **Folds** into the newest live row when that row is an activity row from the same execution with the same `tool`, `text`, `outcome`, `reason` and target. Different commands never fold. The fold replaces that row in place: `count+1`, `revision+1`, `updatedAt`, original `sequence` and `change`. It emits event `action.recorded`. Folding adds no history rows, so repeated typing costs no storage.
- **Appends** otherwise, with event `action.recorded`, no idempotency key and no attachments.
- **Caps** action rows at 2,000 per bot. Beyond that it removes the oldest action rows outright, never a message. Activity rows are left out of the 10,000-row check that refuses new posts, so actions can never block chat.

Other paths: `unacknowledged` ignores activity rows; `edit` (and so delete) refuses them with `validation`; `clear` removes them; `parse` validates stored `activity` and refuses activity on a user row. `list` gets an `actions: false` option, bound into the cursor filter, which the briefing uses for excerpts and counts. Runtime `chat_list`/`chat_get` return activity rows with `activity` present.

Alternative: a separate per-bot action store merged by time on the client. Rejected: Chat pagination, events, clear and ordering already belong to the message log.

### 5. Targets are server IDs; links use existing navigation, server-aware
```
type BotActionTarget =
  | { kind: 'project'; projectId }
  | { kind: 'terminal' | 'workflow'; projectId; sessionId }
  | { kind: 'automation'; automationId }
  | { kind: 'workflowTemplate'; templateId }
  | { kind: 'trigger'; triggerId }
  | { kind: 'settings' }
```
| Ops | Target |
| --- | --- |
| `create_project` (result), `update_project`, `move_project`, `focus_project` | project |
| `open_terminal`, `split_terminal` (result); `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, `update_terminal`, `move_terminal_to_project`, `run_macro` | terminal |
| `create_workflow`, `update_workflow_step` | workflow |
| `create_automation` (result); `update_automation`, `set_automation_enabled`, `run_automation`, `stop_automation_run` (`automation_id`) | automation |
| `create_workflow_template` (result), `update_workflow_template` (`template_id`) | workflowTemplate |
| `update_settings`, `save_shell_profile`, `reorder_shell_profiles`, `set_default_shell_profile` | settings |
| `triggers_create`, `triggers_update`, `triggers_enable`, `triggers_run` | trigger |
| every `close_*`, `delete_*`, `cancel_macro`, `remove_automation_run`, `prune_automation_runs`, `dismiss_missed_runs`, tab/folder/window/file ops, `focus_home` | none |

An automation or template ID from params is linked only on a done call, since the handler validated it. `BotMessagesClient` validates activity with the protocol's `botMessageActivity`, and drops a row whose activity is present but malformed, so it never shows as an ordinary message. Every ID is data.

`BotTab` gains an optional `onRevealAction(target): Promise<'shown' | 'missing' | 'elsewhere'>` from `App.tsx`, where every navigation helper lives, bound to the bot's `serverId`:

- project → if `serverBots`/workspace state for that server still has it, `activateDashboardRow(serverId, project row)`; else `missing`;
- terminal/workflow → find the panel by `sessionId` in that server's terminal inventory, then `activateDashboardRow(serverId, { kind: 'panel', projectId, panelId })`, which covers other servers, other windows and the automation space; `missing` when there is no panel;
- automation → `openAutomationsFromOverview({ kind: 'automation', serverId, automationId })` when the automation is listed for that server; else `missing`;
- workflowTemplate/settings → `openSettings('workflows', templateId)` / `openSettings()`, only when `serverId === currentServerId`; else `elsewhere`;
- trigger → handled in `BotChat` with `onConfigure('triggers')`; `missing` when the bot no longer has that trigger.

`missing` shows "No longer exists" and `elsewhere` shows "Not available from this window", both in the row. Without the prop, rows show no link.

### 6. UI: actions travel through the transcript model; rendering is isolated
`BotChat` maps an activity message to a transcript item `{ kind: 'action', key, activity, text, at }` (extending `TranscriptItem`), and leaves it out of `unread` and read-divider counting. `turnBlocks` groups consecutive action items into one `{ kind: 'actions', items }` block. An action ends an agent turn, so a following bot post starts its own block. Grouping covers the loaded history only, and loading an older page can extend a group at its top. `BotTranscript` renders that block with `BotActionGroup` (new `src/workspace/bots/BotActionRow.tsx`). The unread divider is attached only to non-action blocks, because the unread key is always a post.

Pure helpers in `src/workspace/bots/botActions.ts` decide collapse: show the latest three and a hidden count. They also build the stable group key, the key of the group's first row. `BotActionGroup` keeps "expanded" in a module-level `Set` of group keys per bot. Rows arriving or folding into a group keep that key, so the group stays expanded.

Row design: 22px high, indented to the message text column (past the avatar), `font-size: 12px`, muted colour. A 14px lucide icon per kind (folder, square-terminal, list-checks, zap, layout-template, clock, settings; wrench when there is no target). Then the description, a check or cross mark in shared status colours (ADR-0126), and a `×N` badge, with the full time in `title`. On the right sits a text-button link ("Open terminal" …) that becomes the inline notice after `missing` or `elsewhere`. A failed row shows its reason after a middle dot, ellipsised with a `title`. The "Show N earlier actions" toggle is a small text button above the group.

## Risks / Trade-offs

- **A chatty bot writes many rows, each a durable snapshot write.** Only listed ops record, repeats fold in place, the 2,000-row cap bounds size, and recording runs after the response.
- **Pre-dispatch target resolution may differ from the handler's.** Bot calls do not wait on approvals, so the window is negligible. The link is informational and the handler stays authoritative.
- **Recording must never fail the tool.** It runs after the result is returned, and its errors are caught and logged.
- **Parallel #604 edits to `BotChat`/`BotTranscript`.** Logic lives in new files, and edits to the shared files are a few lines that rebase easily.
- **Action text is visible to anyone who can read the bot's chat.** That is the same audience as the bot's own posts, and the bot already has workspace reach. Text is redacted, and the wording excludes output and values.
