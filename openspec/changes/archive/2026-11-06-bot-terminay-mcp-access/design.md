## Context

Bots run agents inside a per-bot container. Each execution reaches the server only through `openBotRuntimeBridge` (`packages/server-core/src/botService/runtimeBridge.ts`). That bridge runs `terminay-mcp-relay <24-hex id>` as a supervised engine exec stream. The relay exposes a private socket at `/tmp/terminay-mcp-<id>.sock` and multiplexes up to 8 adapter connections over the stream as `{connection, token, message}` frames. Each `terminay-bot-mcp` stdio adapter forwards JSON-RPC with a per-execution secret. The server answers with `BOT_RUNTIME_TOOLS` only. ADR-0093 keeps the workspace MCP registry away from bots.

Pixel reaches the workspace through a chat capability. `ControlCapabilityStore.mintChat` (`apps/terminay-server/src/mcp/controlEndpoint.ts`) keys it `chat:<id>` with workspace reach, and the host's `terminay mcp` stdio adapter (`runServerMcpStdio`) presents it to the local control socket. The control endpoint resolves the token, checks reach, runs `createMcpPermissionGate` and dispatches. The control endpoint and the capability store live only in the desktop host (`electron/main.ts`), so bot access exists where Pixel's MCP does.

The owner decided:

- Access is per bot and off by default.
- Turning it on is standing approval, so nothing ever prompts.
- The user revokes it only by turning it off.
- Session grants are moot.

## Goals / Non-Goals

**Goals:**

- Give an opted-in bot's executions exactly the tool surface and reach of a workspace-reach chat.
- Keep the raw capability token and the host control socket out of the container.
- Revoke at once, including in-flight work, on any of these:
  - toggle-off;
  - delete;
  - execution end;
  - MCP disable;
  - shutdown.
- Work on existing bot images. A rebuild adds only per-connection disconnect reporting.

**Non-Goals:**

- Project-scoped bot reach.
- Per-group overrides for each bot.
- An approval UI for bots.
- MCP tools that manage bots.
- Reaching other servers.
- View operations on a user's client.

## Decisions

### 1. A third caller kind: the bot execution

`ControlCapabilityStore` gains `mintBot(botId, executionId)` and `revokeBot(botId, executionId?)`.

- The caller key is `bot:<botId>:<executionId>`.
- The reach is the workspace, with `projectId = AUTOMATION_SPACE_ID` and scope `write`.
- The principal is `bot: { botId, executionId }`.

`revokeBot(botId)` without an execution id revokes every capability with that prefix. Revocation already aborts the control endpoint's in-flight requests for a revoked caller, the same path chats use, so waits and watches end and no late result is written.

The tools that need a calling terminal are extended to refuse bot callers with `unsupported_op`. View operations need an agent's client. The view relay resolves no client for a bot principal, so they return `renderer_unavailable`. A bot is never routed to whichever client happens to be open. Effects that are not view operations, such as `open_terminal` into the automation space or `create_project`, stand on the server as they do for any caller.

*Alternative:* reuse `mintChat` with a synthetic chat id. Rejected, because approvals and view routing would chase a chat that doesn't exist. This crosses the **MCP authority boundary** (ADR-0068/0072), and ADR-0100 records it.

### 2. The permission gate honours standing approval

In `createMcpPermissionGate`, when `context.bot` is present:

- an `allow` or `ask` policy returns `undefined`, so the call runs;
- a `deny` policy returns `permission_denied`.

The approval service is never called, so a bot never creates, queues or grants an approval. Each call reads `effectivePolicy` afresh.

*Alternative:* allow everything, even Never Allow. Rejected, because Never Allow is the user's server-wide hard stop, not an approval.

### 3. Delivery through a second relay, one MCP session per adapter connection

`runServerMcpStdio` is refactored. A shared `createTerminayMcpSession({ socketPath, token, transport })` builds the `McpServer`, registers the tools, and connects a `LocalControlClient`. The stdio entry point becomes a thin wrapper around it.

The host seam `BotServiceHooks.terminayMcp?` has `open(botId, executionId, isAllowed)`. It mints the capability, then returns a relay handler. For each relay `connection` number, the handler lazily creates one session over an in-memory transport. That session has its own:

- initialization;
- request-id space;
- `notifications/cancelled` handling;
- connected-tools subscription.

When a connection closes, only its session closes, and its in-flight control requests abort. Connections are capped at the relay's 8, and outstanding requests per connection at 16, matching the runtime relay.

`terminay-mcp-relay` gains one backwards-compatible frame, `{connection, closed: true}`, sent when an adapter disconnects. Both relays use it to end only that connection's work. An image built before this frame existed still works. The host then evicts the oldest session once the connection cap is reached, and a session's requests end when the execution does.

`openBotRuntimeBridge` opens a **second** `terminay-mcp-relay` exec. It has its own random 24-hex id and socket, and its own 64-hex relay secret. Each frame's secret is checked with `timingSafeEqual` before the message reaches the handler. The bridge adds the server entry `{ name: 'terminay', command: '/usr/local/bin/terminay-bot-mcp', env: TERMINAY_RUNTIME_SOCKET / TERMINAY_RUNTIME_TOKEN for the second relay }`.

The relay secret is added to the execution's token redactor through `wrapCredential` and to the diagnostic sanitiser, exactly as the runtime secret is. The control token never leaves host memory.

This crosses the **container boundary** (ADR-0093). It reuses the authenticated exec relay, so there is no published port, no host path and no socket mount.

*Alternatives:*

- **Bind-mount the host control socket.** Rejected, because it would expose the host socket and put the raw token in the container.
- **Add the tools to `BOT_RUNTIME_TOOLS`.** Rejected, because it mixes the bot-scoped runtime with the workspace registry.
- **Multiplex both servers on one relay.** Rejected, because a separate relay keeps revocation and failure independent.

### 4. Lifetime, fencing and revocation

- **Fence.** The bot service keeps a per-bot access generation, bumped on every save that turns access off and on delete. At execution start it reads the *current* bot record, not the snapshot, and captures the generation. It passes `isAllowed = () => record still on && generation unchanged && MCP enabled` to the seam. The seam checks `isAllowed()` immediately before `mintBot`, and again after minting, revoking if it has turned false. A toggle-off that races a starting execution can therefore never leave a live capability behind.
- **End.** `bridge.close()` closes the handler (all sessions), calls `revokeBot(botId, executionId)`, and kills the second relay. Every execution end path already reaches `bridge.close()`: stop, timeout, replacement, failure and bot stop.
- **Toggle-off.** `save()` bumps the generation and calls `revokeBot(botId)` before it returns. The relay stays up and answers each call with a revoked error. The execution keeps its runtime tools. Turning access back on never restores a capability to a running execution.
- **Delete.** `removeNow()` bumps the generation and calls `revokeBot(botId)` alongside the existing `runtime.revoke`, before process cleanup. Then the existing delete flow stops the executions.
- **MCP disable and shutdown.** These already revoke every capability in the store. Re-enabling MCP restores nothing, because the seam mints only at execution start.
- **Partial failure.** If minting, opening the session or starting the second relay fails, then:
  - whatever was set up is torn down (revoke, close the handler, kill the relay);
  - a `Bot MCP: Terminay MCP is unavailable for this execution` line goes to Runner output;
  - the execution starts with its runtime servers only.

### 5. Profile field and copy

`terminayMcpAccess: boolean` goes into the protocol `BotProfile` and draft, the client-core parser, and the store parser. A record without the field reads `false`.

The Profile gets a switch under Investigate failures. Its copy says the bot can see and control every project, terminal and app setting Terminay MCP reaches, without asking, and that only Never Allow policies still stop it. While Terminay MCP is disabled, it adds a hint that the access applies once MCP is enabled; the switch stays editable.

The bot's approval-mode copy is unchanged in the UI. Only the spec's rationale is narrowed to the agent's own tools.

## Risks / Trade-offs

- [A bot with access can drive any terminal unattended under Always Allow, or even under Ask Permission] → The access is opt-in per bot and off by default, the copy states the reach plainly, and Never Allow still binds the bot.
- [Prompt injection through a bot's inputs, such as fetched trigger content, can steer workspace tools] → This is the same trust Pixel carries, and the ADR names it.
- [A second relay doubles the exec streams for each opted-in execution] → It opens only when access is on.
- [Refactoring `runServerMcpStdio`] → The stdio path is a thin wrapper, and the existing stdio and conformance tests guard it.

## Migration Plan

None is needed. Bots without the field read as off. Rolling back drops the field.

## Open Questions

None. ADR-0100 records the supersession of ADR-0093's bot MCP prohibition, and the parts of ADR-0072 decision 1 that name only terminals and chats.
