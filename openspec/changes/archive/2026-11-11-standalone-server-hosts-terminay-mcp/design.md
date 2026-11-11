## Context

Terminay MCP has two halves. Server Core (`packages/server-core`) composes the
services behind the tools: approvals, app windows, workspace view relay,
connected servers, agent chat and bots. The host half lives in
`apps/terminay-server/src/mcp/`. It holds the control endpoint, capability
store, socket placement, the stdio entry, and one adapter per tool group. Only
Desktop assembles the host half, in about 2,000 lines of `electron/main.ts`
(`startMcpControlEndpoint`, `createDesktopMcp*Adapter`, the permission gate,
`bindMcpGateway`, capability persistence and pruning, and launch environment
minting).

The standalone CLI (`apps/terminay-server/src/cli.ts`) composes Server Core
without `mcpApprovals`, `appWindows`, `connectedServers`,
`terminalLaunchEnvironmentFor`, `agentChat.mcp`, `botTerminayMcp` or an MCP
install command. It never starts an endpoint. Server Core advertises
`mcp-approvals.v1` and `workspace-view.v1` only when `mcpApprovals === true`,
and the three app-window capabilities only when `appWindows` is also given
(`composition.ts:2791-2801`). Desktop's `serverTerminalAuthority.ts` repeats the
same conditions in its own capability list.

In-force ADRs that apply: 0017 (one server type; every project executes on its
server), 0072 (MCP reach is the authority line, combined with the user's
permission policy), 0074 (a terminal's capability follows it between projects
and never widens), 0037 (MCP Apps
reach terminals through a Terminay gateway), 0054 (socket placement in an
owner-only runtime directory), 0070 (view operations applied by the agent's
client), 0076 (window records outlive restarts), 0088 (state files replaced
durably; a corrupt credential store restores nothing), 0100 and 0102 (bot
execution capability).

## Goals / Non-Goals

**Goals:**

- A standalone server serves the same MCP surface as Desktop's embedded one.
- One copy of the MCP host wiring, composed by both hosts.
- No composition switch can produce a server that serves MCP without approvals,
  app windows or workspace view.
- The **Enable Terminay MCP server** setting keeps working on both hosts.

**Non-Goals:**

- Changing any tool's behaviour, the control protocol, or the permission model.
- Removing capability negotiation. An older server or client still lacks these
  capabilities, and the client keeps degrading for it.
- Rewording the connection menu's "Without …" line. Once current servers stop
  triggering it, it only appears for real version skew.
- Bots on platforms where the standalone server does not already compose them.

## Decisions

### 1. One MCP host module in `apps/terminay-server`

Add `apps/terminay-server/src/mcp/host.ts` exporting `createMcpHost(options)`.
It owns the `ControlCapabilityStore`, socket placement, capability persistence
(`<dataRoot>/mcp-capabilities.v1.json`), the `ConnectedServerGateway`, and every
adapter now built in `electron/main.ts`. It works in two phases, because Server
Core needs some of it before the composition exists and the adapters need the
composition:

- **Before composition** the host hands out the composition inputs:
  `terminalLaunchEnvironmentFor`, `agentChatMcp`, `botTerminayMcp`, the MCP
  install `serverCommand`, and `onTerminalExit` and terminal-move hooks.
- **`bind(server)`** takes a narrow `McpHostServer` view: workspace repository,
  terminal service, agent status, activity, and the Server Core composition.
  It restores and prunes persisted capabilities, binds the gateway and the
  settings observer, and starts the endpoint.
- **`stop()`** stops the endpoint, closes the gateway, and revokes capabilities.

The adapters already read through accessors (`serverTerminalAuthority?.…`), so
they move with their bodies largely unchanged. Accessors are replaced by the
bound `McpHostServer`.

Host-specific inputs are options: `serverId`, `dataRoot`, the placement inputs
(temporary and runtime directories, platform, holder addressing),
`serverCommand()`, `clientVersion`, `homeDirectory`, `initialSettings`,
`onSettingsChange`, `openTerminal(request)`, and optionally how saved digests
are read and written (Desktop passes its own so a reset credential store is
reported to the user once). When the socket cannot be placed, `bind()` rejects
with the placement error; each host reports it its own way. Desktop's `serverCommand` is `process.execPath` with
`ELECTRON_RUN_AS_NODE`. The CLI's is `process.execPath` with the absolute path
of `mcpEntry.js`, resolved with `fileURLToPath(new URL('./mcpEntry.js',
import.meta.url))`, so it does not depend on the working directory or `PATH`.

The adapters use a few Desktop helpers outside their own bodies. Each gets a
narrow replacement:

- `createServerOwnedTerminalSession` (used by `open_terminal`, `create_project`
  and `split_terminal`) becomes the host option `openTerminal`. Desktop passes
  its existing function, which applies its terminal settings, environment
  overlays and recording. The CLI passes the same Server Core launch path that
  a client's `terminal.create` uses.
- `embeddedServerId` for the project and window handle codecs becomes the
  `serverId` option.
- `nodeTerminalLaunchPathAuthority.homeDirectory` becomes the `homeDirectory`
  option.
- `desktopMcpToolAvailability` moves with the adapters. It reads only the
  composition.

The module must not import `electron`. A test imports the built host from
`apps/terminay-server/dist` in plain Node to prove this.

*Alternative considered:* add a thin standalone copy of the endpoint with only
the terminal adapter. That would leave two diverging hosts and keep the current
bug class, so it is rejected. *Alternative:* move the host into Server Core.
That is rejected because the endpoint is a Node socket server, and the
package's existing split puts it in `apps/terminay-server`, which Desktop
already depends on.

Boundary: the module stays in the privileged server process. Renderer code
still reaches nothing but the preload API, and the socket stays local IPC
(ADR-0054).

### 2. Server Core always composes approvals, app windows and workspace view

Remove the `mcpApprovals` option. `McpApprovalService` is always constructed,
and `appWindows` options become configuration with defaults: a store directory
is optional, as it is now, and the attachment directory defaults to a
server-owned temporary directory. The five capabilities are always advertised.
Desktop's hand-written capability list in `serverTerminalAuthority.ts` takes
them from the composition instead of re-deriving the condition.

Boundary: approvals are the user-policy half of MCP authority (ADR-0072).
Making them unconditional removes the only configuration in which tools could
run unchecked.

### 3. The setting stays the on/off switch, and applies before any minting

`applyMcpSetting` moves into the host. Disabling it revokes capabilities, ends
app windows and closes the gateway, exactly as today. The standalone server
reads the same `terminayMcp.enabled` key from its settings repository.

Order matters at startup. `createMcpHost` takes `initialSettings` and sets the
store's enabled state from them in its constructor, before it hands out any
minting function. Composition, workspace restore, automations and bots start
after that, so a persisted `terminayMcp.enabled: false` means no terminal,
chat or bot is ever minted a capability during startup. `bind()` then
subscribes to later settings changes.

### 3a. Capability persistence order (ADR-0088)

`bind()` keeps today's Desktop order. It restores saved digests for running
terminals, subscribes persistence to store changes, saves once, then prunes.
`stop()` removes the persistence subscription **before** the endpoint stops and
revokes capabilities, so a shutdown never overwrites the saved digests with an
empty store. Terminals kept across a restart by the session holder therefore
keep their tokens. A corrupt digest file restores nothing, and every running
terminal must be granted again. These three cases get host tests: a retained
terminal, an ended terminal and a corrupt file.

### 4. Standalone startup failure is fatal

If socket placement fails, `cli.ts` prints the existing
`describeControlSocketPlacementFailure` message and exits non-zero. A server
that silently ran without MCP while advertising it would be worse, and
advertising less based on a runtime failure would bring back the condition this
change removes. In the Docker image the data root is short, so placement does
not fail in practice.

Placement follows ADR-0054. A data root that is too long still succeeds when an
owner-only runtime directory is usable. Startup fails only when that fallback
is also unusable. The CLI resolves MCP placement before it binds the Git
command socket, which uses the same placement rules, so the reported failure is
the MCP one. Tests cover both cases: a long data root with a usable runtime
directory starts, and a long data root with an over-long runtime directory
fails.

### 5. Standalone composes connected servers, the install router and bot MCP

Connected servers use `<dataRoot>/mcp-connected-servers.v1.json` and the
standalone vault, mirroring Desktop. The install router gets the CLI's
`serverCommand`. Bots are not a Server Core composition option in the CLI; they
are built by `createBotServerService`. The CLI passes the host's
`botTerminayMcp` into that constructor, as Desktop's authority does, so an
opted-in bot gets Terminay MCP, an opted-out bot gets none, and turning access
off revokes it (ADR-0100, ADR-0102).

## Risks / Trade-offs

- [Moving 2,000 lines out of `main.ts` can break Desktop subtly] → Move bodies
  without rewriting them, keep the existing Desktop MCP tests and E2E shards
  green, and add a host-module unit test suite that runs against a fake
  `McpHostServer`.
- [Standalone terminals now carry a capability token in their environment] →
  This is already true on Desktop and covered by the inheritance disclosure
  requirement. The token is per terminal, revoked on exit, and the socket is
  owner-only.
- [An existing Docker data root may have a long path] → Fail loudly at startup
  with the path, the length and the limit. The fix is a shorter mount.
- [Server Core tests that build a server without approvals] → Update them. No
  product configuration depends on running without approvals.
- [The standalone endpoint could be wired without the permission gate or with
  the wrong reach] → Standalone integration tests drive the real endpoint over
  the socket: Ask First prompts, Never Allow refuses, a cross-project terminal
  is refused before any prompt, disabling cancels a pending request, and a
  project move revokes the old approvals without widening reach (ADR-0074).
- [Workspace view routing could regress] → Routing to the agent's client is
  Server Core logic this change does not move, and its existing tests stay. The
  standalone suite adds one `renderer_unavailable` case with no client
  attached, to prove the relay is wired.

## Migration Plan

No user data migrates. A standalone server upgraded to this release starts its
endpoint on first boot. Terminals launched before the upgrade have no token
until they are relaunched. Rolling back drops back to the previous behaviour,
with no state left behind beyond `mcp-capabilities.v1.json`, which older
servers ignore.

## Open Questions

None. ADR-0017 already requires every server to own MCP. This change records,
as a new ADR, that a host cannot opt out of approvals, app windows or workspace
view.
