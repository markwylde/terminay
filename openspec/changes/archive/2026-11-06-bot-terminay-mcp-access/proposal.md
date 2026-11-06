## Why

A bot can't see or act on anything in Terminay outside its own container. When a user asks one "can you see all my projects and terminals?", it has to say no, while Pixel answers the same question at once. Some bots are meant to help run the workspace itself, such as a release bot that drives terminals or a triage bot that reads build output. The user wants to give those bots the same Terminay MCP reach Pixel has. Every other bot should stay sealed in its container.

## What Changes

- Each bot gains a **Terminay MCP access** setting in its Profile. It is off by default, including for every bot that exists today.
- While it is on, every execution of that bot gets a workspace-reach Terminay MCP capability. It grants the same tools a workspace-reach chat such as Pixel holds, and the agent sees them as a `terminay` MCP server next to its existing runtime tools. The capability is minted when the execution starts and revoked when it ends.
- Turning the switch on counts as the user's standing approval. A bot execution's calls to groups set to Ask Permission run without a prompt. Groups set to Never Allow are still refused. Turning off **Enable Terminay MCP** for the server turns the access off too.
- Turning the switch off, or deleting the bot, revokes the capability of every live execution of that bot at once.
- Bots still can't be created, read, changed or prompted through any MCP capability, including their own.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: the bot profile gains the Terminay MCP access setting, and bot authority states what a bot holding it may reach. The approval mode governs only the agent's own permission requests.
- `mcp-server`: a third caller kind, the bot execution, gets its own server-minted workspace capability alongside the terminal and chat callers. It covers how the capability is minted, how it is delivered over its own relay (one MCP session per connection) and how it is revoked, including in-flight work.
- `mcp-permissions`: bot execution callers never prompt. Ask Permission groups run, and Never Allow refuses.
- `mcp-app-control`: bot executions hold workspace reach.
- `mcp-workspace-view`: a bot execution has no agent's client, so view operations return `renderer_unavailable`.

## Impact

- `packages/protocol` adds the new bot profile field, and its parsers and defaults.
- `packages/server-core/src/botService` changes the profile store, the execution start and end paths, and `runtimeBridge.ts`, which relays a second MCP server.
- `apps/terminay-server/src/mcp` gives the control endpoint a bot-execution mint and revoke, the permission gate a bot-caller rule, and the MCP tool surface a way to be served in process over the bot relay.
- The renderer adds a switch to the bot Profile, with copy saying what access the bot gets.
- The existing `terminay-mcp-relay` and `terminay-bot-mcp` adapters carry the second server on its own socket and token. The relay gains a backwards-compatible "connection closed" frame, so a disconnect cancels only that connection's requests.
- A new ADR supersedes the part of ADR-0093 that keeps Terminay MCP away from bots. It also adds the bot execution as a caller kind to ADR-0068/0072.
