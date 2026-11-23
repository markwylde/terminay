## Context

Runtime tools are served per execution by `BotExecutionRuntime.call`, and every read uses `source.botId`. Bots are isolated from each other by that scoping. Issue #644 deliberately opens a narrow read path across that boundary, and its security requirements are settled: opt-in per bot, off by default, user-only, strictly read-only, allowlisted, no secrets, untrusted content, same server.

The existing own-bot views are not safe to reuse across bots. A trigger summary includes its condition, with command text, URLs and header references. A profile includes instructions and sign-in. A message can carry an action link into a project or terminal. Existing summaries also truncate text before anything could redact it.

## Goals / Non-Goals

**Goals:**

- A permitted bot can list bots and read another bot's config, sessions, ended output, chats and triggers.
- A bot without the setting gets `forbidden` from every inspection tool.
- Secret-bearing fields cannot reach a response, including a field added later.

**Non-Goals:**

- Any write, stop, steer, trigger change or file access on another bot.
- Reading another bot's memories, files, inbox, events, shell, desktop or live output.
- Reading bots on another server.
- Per-target grants. The setting covers all other bots on the server.
- Detecting secrets a person or agent typed into free text. Only the source bot's known credentials can be recognised and redacted.

## Decisions

### 1. A profile boolean, read live on every call, in both directions

**Boundary: bot-to-bot isolation.** `inspectOtherBots` is stored on the bot profile and a missing value reads as false. Each inspection call reads the calling bot's current record, not its session snapshot. Turning the setting off applies to a running execution's next call, and turning it on does too. The check runs first, so a forbidden caller learns nothing about which bots exist. Terminay MCP access is independent of this setting.

Alternative: snapshot at execution start. Rejected because revocation would wait for the execution to end.

### 2. Only the user's authenticated profile save can change it

**Boundary: client authority versus MCP capability.** The setting is changed only through the bot save operation, which already refuses every capability-bound caller, including MCP. No runtime tool accepts a profile field. The field is not a Terminay setting path, so `update_settings` cannot reach it.

### 3. A separate module with exact response shapes

**Boundary: secret containment.** A new `runtimeInspect.ts` builds each response field by field. Spreading a stored record is not allowed, so a future secret field is absent by default. Every result is `{ untrustedData: true, notice, ...body }`.

| Tool | Arguments | Body |
| --- | --- | --- |
| `bots_list` | `cursor`, `limit` | `items`: `id`, `name`, `agentId`, `modelId`, `enabled`; `nextCursor`, `truncated` |
| `bots_get` | `botId` | `bot`: `id`, `name`, `avatar`, `colour`, `description`, `agentId`, `modelId`, `enabled`, `approvalMode`, `maxTurnMs`, `investigateFailures`, `createdAt`, `updatedAt` |
| `bots_sessions_list` | `botId`, `cursor`, `limit`, `activeOnly` | `items` of session summaries; `nextCursor`, `truncated` |
| `bots_sessions_get` | `botId`, `sessionId` | `session`: a summary plus `startupStage`, `temporary`, `attempts`, `dispatchedAt`, `outcome` (`disposition`, `reason`, `action`), `failures` (`kind`, `sessionId`, `triggerId`, `triggerName`, `at`, `reason`), `failuresOmitted` |
| `bots_sessions_output` | `botId`, `sessionId`, `cursor` | `sessionId`, `state`, `text`, `nextCursor`, `truncated` |
| `bots_chat_list` | `botId`, `cursor`, `limit`, `search`, `threadId` | `items` of message summaries; `total`, `nextCursor`, `truncated` |
| `bots_chat_get` | `botId`, `messageId`, `cursor` | `message`: a summary without `excerpt`, plus `attachments` (`name`, `mime`, `size`); `text`, `nextCursor`, `truncated` |
| `bots_triggers_list` | `botId`, `cursor`, `limit`, `search` | `items` of trigger summaries; `total`, `nextCursor`, `truncated` |
| `bots_triggers_get` | `botId`, `triggerId`, `cursor` | `trigger`: a summary; `text` (the prompt), `nextCursor`, `truncated` |

- **Session summary:** `id`, `order`, `task`, `state`, `startedAt`, `endedAt`, `trigger` (`kind`, `triggerId`, `triggerName`, `failureCount`), `reason`, `cause`, `supersededBy`.
- **Message summary:** `id`, `sequence`, `author`, `executionId`, `createdAt`, `updatedAt`, `threadId`, `thread` (`replyCount`, `lastReplyAt`, `authors`), `excerpt`, `textBytes`, `attachmentCount`, and `activity` (`tool`, `outcome`, `count`, `reason`). Lists carry an attachment count, and `bots_chat_get` carries attachment metadata, as the own-bot tools do.
- **Trigger summary:** `id`, `name`, `enabled`, `recovery`, `startupRetries`, `onNeedsHuman`, `missedCount`, `missedLatest`, `promptBytes`, `condition`, `health` (`state`, `error`, `cause`), `blocker` (`reason`, `action`).
- **Trigger condition:** `kind`, plus `at`, `intervalMs`, `cron` or `event` where that kind has one. Command, cwd, URL, headers, select, match, paths and globs are withheld.

Instructions, sign-in, pinned memories and access settings are withheld from config, because instructions are free text that may hold pasted credentials. Attachment IDs, dispatch details and action link targets are withheld from messages, so nothing points into a project or terminal.

Alternative: denylist secret fields. Rejected because a new field would leak by default.

### 4. Structured secrets are withheld, free text is credential-redacted

**Boundary: credential isolation.** The field prohibitions apply to structured fields, which are never returned. Message text, trigger prompts, reasons and runner output are the content the feature exists to show. They can contain anything a person or agent wrote, so a URL or a pasted unrelated key in that text stays visible. The source bot's known credentials are replaced. The Profile help text states that the bot can read this content.

### 5. Redact the original string before any truncation, fail closed

**Boundary: credential isolation.** The inspection module does not reuse truncated summaries. It reads each original string, redacts it under one credential lease per source bot for the whole call (`openRedactor`), and only then cuts an excerpt or slice. A token therefore cannot survive as a prefix at a cut. If the lease cannot be opened for a bot with a sign-in, or redaction fails, the call fails and returns no content. The lease is always released.

### 6. Mark content as data at both layers

**Boundary: prompt-injection trust.** Tool descriptions say the content is untrusted. Every result carries the marker. Only a permitted bot's briefing mentions these tools.

### 7. Stable, bound paging

**Boundary: cross-bot cursor isolation.** Lists sort by a stable key. `bots_list` cursors are signed by the caller's own message log, and target-scoped cursors by the target's log, so a cursor for one target fails on another. Each inspection list uses its own cursor kind or filter, so an own-bot cursor is not accepted. The bot and trigger list filters include a hash of the ordered IDs, so a create or delete between pages returns `conflict` and the caller reloads, rather than skipping or repeating a row. Text slices use the existing limits, and the final 8 KiB check in `call` applies.

### 8. Self-targeting is refused

Inspection tools target other bots. A bot naming itself gets a validation error pointing to its own tools, which keeps the two scopes distinct.

## Risks / Trade-offs

- [Free text can contain a secret that is not the bot's credential] → The Profile states what the bot can read, the setting is off by default, and only known credentials can be redacted.
- [Another bot's text may try to instruct the reader] → Content is marked as data in descriptions and results, and the tools cannot act on another bot.
- [A permitted bot sees every other bot on the server] → The setting is off by default and the Profile says what it grants.
- [Omitting trigger commands and instructions limits some diagnosis] → Secret safety is the settled priority. The user can share those details directly.
- [Redacting message history before search costs CPU on a long log] → The stored log is bounded, one credential lease serves the whole call, and search and page sizing use the redacted snapshot.

## Migration Plan

No migration is needed. Saved bots have no field and read as off. Rollback removes the tools, and a stored field is ignored.

## Open Questions

None. ADR-0138 supersedes ADR-0100 decision 4 and ADR-0093's bot scoping only for this read path.
