# ADR-0108: Every server host composes one MCP host, and no host can opt out of approvals, app windows or workspace view

Status: accepted
Date: 2026-11-11

## Context

ADR-0017 makes every Terminay Server own its projects, including MCP, and the
`mcp-server` spec says every server exposes its own control socket. In practice
only Desktop assembled the MCP host: the control endpoint, capability store,
tool adapters, permission gate and connected-server gateway were wired inside
`electron/main.ts`. Server Core composed approvals, app windows and workspace
view only when a host passed `mcpApprovals: true`.

The standalone server never passed it and never started an endpoint. A freshly
installed standalone server therefore advertised a degraded connection, and
agents in its terminals had no Terminay MCP. The opt-in flag also made it
possible to build a server that served MCP tools without the user's
permission policy, which is half of MCP authority under ADR-0072.

## Decision

1. **One MCP host module.** The MCP host (control endpoint, capability store and
   its persistence, socket placement, every tool adapter, the permission gate,
   the connected-server gateway binding, and chat and bot capability minting)
   lives in `apps/terminay-server` as one module. Desktop and the standalone
   server both compose it. A host supplies only host facts: its data root,
   socket placement inputs, the command that starts its MCP stdio entry, its
   version, and how it reports a placement failure.
2. **No opt-outs.** Server Core always composes MCP approvals, app windows
   (with the mirror and attachments) and workspace view, and always advertises
   their capabilities. There is no composition option that removes them.
3. **The user setting is the only switch.** **Enable Terminay MCP server**
   governs MCP on every host. Turning it off revokes capabilities, ends app
   windows and closes connected servers, and does not change what the server
   advertises.
4. **Placement failure is fatal on a standalone server.** A standalone server
   that cannot place its control socket refuses to start, rather than serving
   without MCP.

## Consequences

- A new MCP tool or adapter is written once and works on every server.
- Capability negotiation for these features remains only for version skew
  between releases. It is never a statement about which host a server is.
- Desktop's `main.ts` no longer owns MCP logic, so Desktop-only changes cannot
  silently diverge from the standalone server.
- Server Core tests can no longer build a server without approvals. Tests that
  need a minimal server use the default policy instead.
- Terminals on a standalone server receive a per-terminal capability token in
  their environment, as Desktop terminals already do.
