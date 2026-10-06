# ADR-0041: The MCP adapter may read a document the agent names, to show the user; the server never opens it

Status: accepted
Date: 2026-10-07

## Context

ADR-0037 lets an agent show its own HTML in its terminal through Terminay's MCP
server. The document travels inline, so an agent that reuses one design writes
the same several kilobytes out on every call. The design usually already exists
as a file beside the agent.

Terminay's own MCP tools have performed no filesystem access, and the
`mcp-server` contract says so. ADR-0011 and ADR-0020 keep the Terminay Server
from opening a path a caller chose outside a project root.

The stdio adapter is not the server. The agent CLI spawns it, so it runs as the
agent's user, in the agent's process tree, under whatever sandbox the CLI gives
its children.

## Decision

1. **The stdio adapter may read one file per `show_window` call**, the document
   the agent names by absolute path, and sends its contents to the server as the
   window's document. It reads a regular file only, bounded to the same size as
   an inline document.
2. **The Terminay Server never receives or opens the path.** No server-side
   filesystem authority is added.
3. **The contents never return to the agent.** They are shown to the user. The
   inline and by-path forms are exclusive, so an agent cannot attach its own
   script to a file it names.
4. **This is the only file read in Terminay's own MCP surface.** It does not
   make the adapter a general file reader; any further read needs its own
   decision.

## Consequences

- An agent can reuse a saved window design by sending a path and a small JSON
  value, across sessions and server restarts, with no template store.
- A reviewer of the MCP surface has one named file read to audit, in the
  adapter, with a stated bound and no path leaving the process.
- An agent can cause a file the CLI's own permission rules would not let it read
  to be displayed to the user. The user owns that file and the agent learns
  nothing from it.
- On a remote server the path is resolved where the agent runs, which is where
  the agent's own files are.
