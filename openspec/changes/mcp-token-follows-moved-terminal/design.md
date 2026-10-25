## Context

`ControlCapabilityStore` (`apps/terminay-server/src/mcp/controlEndpoint.ts`)
keeps one capability per terminal session. Each is stored by token digest with
`projectId` and `reach`. A terminal receives its raw token once, in its launch
environment (`terminalLaunchEnvironmentFor` in `electron/main.ts`). When a
terminal panel moves to another project, the workspace protocol emits a
`TerminalSessionRehome { sessionId, sourceProjectId, targetProjectId }`, and the
embedded host calls `onTerminalRehomed`. That callback currently calls
`mcpCapabilities.revokeSession(sessionId)`. Nothing mints a replacement, and
the store's `moveTerminal` is never called. Even a replacement could never
reach the shell. Revoking the capability cuts off the terminal permanently,
which `e2e/mcp-after-terminal-move.spec.ts` reproduces.

The endpoint resolves the token on every request. Revocation listeners abort
in-flight requests for the digest (`abortForRevokedDigest`) and end MCP
approvals and session grants (`mcpApprovals.revokeTerminal`). Capabilities are
persisted by digest when terminals survive restarts.

Boundary crossed: **local control socket → Server** (ADR-0011). The token must
stay opaque and revocable. It must resolve to server-owned state and never be
widened by anything the caller supplies.

## Goals / Non-Goals

**Goals:**

- A moved terminal keeps working MCP, scoped to its new project, for agents
  already running and for agents started later.
- No window in which the token reaches both projects. No old-scope approval,
  grant, or request survives the move.
- A move never widens a token.

**Non-Goals:**

- Delivering a new token into a running shell (impossible by design).
- Changing which callers may move terminals (ADR-0072: workspace reach only).
- Chat capabilities. A chat's reach comes from its chat record, not a panel.

## Decisions

1. **Re-scope in place, keeping the digest.** A new store method
   `followTerminal(sessionId, projectId, placement)` rewrites the stored entry's
   `projectId` and `reach` under the same digest in one synchronous map update.
   Because the endpoint resolves the token per request, the next call sees the
   new scope, and no instant has both scopes valid. It replaces the unused
   `moveTerminal`, whose mint-a-new-token behaviour cannot help a running
   shell.
   *Alternative:* mint a new token and have the stdio adapter fetch it from the
   endpoint using the old one. Rejected: the endpoint would need a token-exchange
   path, and an old token would gain the power to obtain a new one, which is
   more surface for no benefit.

2. **End per-scope state as revocation does.** Before the re-scope, the store
   notifies its revocation listeners for the old digest. That aborts in-flight
   requests authorized under the old scope and ends approvals and session
   grants. The listener contract is reworded to "the capability's authority
   under its current scope ended" so it covers both revocation and re-scope.
   *Alternative:* a separate `onRescoped` event. Rejected: every current
   listener wants the same reaction, and a second event invites one being
   missed.

3. **Follow only when the move narrows or keeps reach.** Moving a terminal
   project→project or automation-space→project keeps or narrows reach. In both
   cases the token follows, and its reach is still derived only from canonical
   placement, which honours ADR-0030 and ADR-0072. Moving project→automation
   space would widen the token to workspace reach, so `onTerminalRehomed`
   revokes it, as today. The store also refuses a follow that would widen reach,
   so the rule holds even if a caller gets it wrong.
   *Alternative:* follow into the automation space as well. Rejected: a token
   held by an arbitrary process in that shell would silently gain app-level
   control.

4. **Persistence follows for free.** `followTerminal` triggers `changed()`, so
   the saved snapshot records the new `projectId`/`reach` against the same
   digest, and `restore` reinstates the moved scope after a restart.

## Risks / Trade-offs

- [A process in the moved shell gains the new project's terminals] → The user
  chose to move the terminal, and the shell's own authority already moved with
  it. The old project becomes unreachable at the same instant.
- [A request in flight across the move completes against the old scope] → It is
  aborted with `revoked` before the re-scope, exactly as on revocation.
- [Rehome callback order: re-scope races a call] → The store update is
  synchronous inside the rehome callback. A request resolved before it is
  aborted by the listener, and one resolved after sees the new scope.

## Migration Plan

No data migration: a persisted entry keeps its shape. Terminals that were moved
before this ships have already lost their capability and stay broken. Terminals
moved afterwards keep MCP.

## Open Questions

None. ADR-0011's "resolve to immutable server/project/session state" is
honoured: the immutable binding is token → session, and the project is read
from the server's canonical placement of that session. ADR-0074 records this.
