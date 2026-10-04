# ADR-0037: MCP Apps and agent-authored UI reach a terminal through Terminay's own MCP server, acting as a gateway

Status: accepted
Date: 2026-10-04

## Context

MCP Apps (SEP-1865, extension `io.modelcontextprotocol/ui`) let an MCP server
supply an interactive HTML view for a tool. The view is delivered to the host,
which is the MCP client of that server. For an agent CLI running in a Terminay
terminal the client is the CLI, which renders text only, so Terminay never sees
the view. Terminay renders terminals in a web surface and can show HTML, but it
must not hook, patch, or reconfigure any agent CLI (ADR-0025 keeps detection
outside the CLIs for the same reason).

Terminay already has one sanctioned channel into every agent: its own stdio MCP
server, whose calls are attributed to a terminal session by capability token
(ADR-0031). A prototype
([evidence](./evidence/mcp-apps-terminal-windows-spike.md)) showed that channel is
enough.

## Decision

1. **Terminay's MCP server is a gateway.** Terminay Server is the MCP client of
   servers the user lists in Terminay settings. It advertises the MCP Apps
   extension to them, offers their model-visible tools to the agent under an
   entry prefix, forwards calls, and renders a tool's UI resource in the calling
   terminal.
2. **Agent-authored UI uses the same channel.** Terminay's own tools let the
   agent show its own HTML in the calling terminal. There is one rendering path
   for both sources.
3. **A window belongs to the terminal session whose capability made the call,**
   and is a server-owned record. The client that holds that session's
   presentation lease runs the view.
4. **Upstream connections are server-only and hold no Terminay authority.** A
   connected server never receives a capability token or the control socket, and
   a view can reach only the server that supplied it.
5. **Terminay never reads or writes an agent CLI's MCP configuration** beyond its
   own registration entry.

## Consequences

- MCP Apps work for any agent CLI that can use the Terminay MCP server, with no
  per-agent code.
- A user who wants a server's UI adds that server to Terminay, not to the agent.
  Adding it to both shows its tools twice.
- The MCP surface is no longer "terminal control and automation only": it carries
  third-party tools. They are governed by their own permission group and run in
  the third party's process.
- The stdio adapter's tool list becomes dynamic.
- Terminay Server gains outbound connections and child processes it did not have,
  with their own lifecycle, bounds, and secrets in the vault (ADR-0003).
- Agent CLIs that later implement MCP Apps themselves are unaffected; this
  decision does not depend on them.
