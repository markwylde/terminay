## Why

When a user tells a bot "look at what the other bot said" or "why did that bot fail", the bot cannot look. The user has to paste the other bot's message or output into the chat (issue #644). Every runtime read tool is scoped to the calling bot, and no tool lists the bots on the server.

## What Changes

- Add an **Inspect other bots** profile setting, off unless the user turns it on. Only the user can change it, in bot settings. No MCP tool can change it.
- Add nine read-only runtime tools for a permitted bot: `bots_list`, `bots_get`, `bots_sessions_list`, `bots_sessions_get`, `bots_sessions_output`, `bots_chat_list`, `bots_chat_get`, `bots_triggers_list` and `bots_triggers_get`.
- Without the setting, every one of these tools returns `forbidden`, before any lookup of the target. The setting is read from the bot's current record on every call, so turning it off applies to running executions at once.
- Responses are built from explicit allowlists. They never carry credentials, tokens, environment values, header secrets, sign-in state, bot instructions, trigger commands, URLs, paths or links into projects and terminals.
- Other bots' content is redacted with the source bot's credentials and marked as untrusted data, in tool descriptions and in every result.
- Results keep the existing page, slice and 8 KiB limits. An unknown or deleted bot returns `not_found`.
- The existing own-bot tools stay scoped to the calling bot.

## Capabilities

### New Capabilities

- `bot-inspection`: the read-only runtime tools through which a permitted bot inspects other bots on its server, and the permission, allowlist, redaction and untrusted-data rules that bound them.

### Modified Capabilities

- `terminay-bots`: the bot profile gains the Inspect other bots setting, and bot authority admits this one permitted read path.
- `bot-message-log`: scoped runtime MCP names inspection as the only authority a bot has over another bot.

## Impact

- `packages/protocol/src/bots.ts`, `packages/client-core/src/bots.ts`: the new profile field.
- `packages/server-core/src/botService/`: profile validation, a new inspection module, and tool registration and briefing text in `runtime.ts`.
- `src/workspace/bots/BotProfilePanel.tsx`: the visible setting.
- Server-core, client-core and E2E tests.
- New ADR recording the boundary between bots.
