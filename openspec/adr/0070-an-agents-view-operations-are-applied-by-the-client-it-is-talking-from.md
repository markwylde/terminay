# ADR-0070: An agent's view operations are applied by the client it is talking from

Status: accepted
Date: 2026-10-17

## Context

Split layout, pane sizes, the tab in front, and the shown project and folder
are each device's own state. The server never sees them. MCP runs on the
server, so its layout tools wrote the server's logical folder layout, which no
client renders, and still reported success. An agent asked to build a 2x2 grid
reported that it had, and nothing on screen changed.

The protocol has no server-initiated request. Server-to-client round trips are
addressed transient events, answered by ordinary client commands (ADR-0039).

## Decision

1. **A view operation from an MCP caller is applied by exactly one client: the
   one the agent is talking from.**
   - For a terminal caller, this is the holder of the calling terminal's
     presentation lease, on its connection.
   - For a chat caller, it is the connection that sent the chat's latest
     message.
2. **The server sends the operation as an addressed transient
   `workspace-view.request` event.** Only a connection that attached as
   view-capable receives it. That connection answers with a
   `workspace-view.respond` command, which no other connection may answer for
   it. The reply is the client's view after the change.
3. **The client is a target, never an authority.** Every reference is checked
   against the caller's capability scope before the request is sent. The reply
   is bounded, shape-checked, and filtered to that scope. Nothing in a reply
   grants or widens anything.
4. **A view operation without a reachable client fails with
   `renderer_unavailable`** and changes nothing. A view result reports only
   what the client confirmed.
5. **The server's logical split layout and active panel are not written by
   MCP.** Device view state stays local. No device's view changes because an
   agent acted for another device.

## Consequences

- A view tool depends on a live client. Headless callers, such as an
  automation terminal nobody is watching, can still open, write, and read
  terminals but cannot arrange them.
- A terminal's view requests follow its lease. When a user takes control on
  another device, that device receives them from then on.
- Agent chats now remember the connection that last sent a message, in memory
  only.
- Adding a view tool means adding a relay operation the renderer implements and
  a server-side filter for its reply.
- The trust-boundary review (ADR-0011) gains an invariant: renderer replies to
  view requests are data, never authority.
