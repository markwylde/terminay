# ADR-0068: MCP authority is capability scope combined with a user permission policy, and the caller is a terminal or a chat

Status: accepted, supersedes ADR-0031
Date: 2026-10-16
Supersedes: ADR-0031

## Context

ADR-0031 made MCP authority two-part: a capability scope minted from a
terminal's canonical placement, and a server-owned permission policy for each
group of operations. It bound approvals and session grants to "the calling
terminal's capability", presented inline with that terminal. It carried forward
ADR-0030's rule that only automation-space terminals receive workspace scope.

The `add-agent-chat-and-pixel` change adds server-owned agent chats whose agents
run outside any terminal (ADR-0067). Each chat chooses its MCP reach when it is
created: none, one project, or the whole server. The owner decided chats use the
existing permission policy with no separate one. Under ADR-0031 that is
impossible. No capability exists without a terminal, no workspace scope exists
outside the automation space, and there is no place to show an approval for a
caller without a pane.

## Decision

1. **MCP authority has two parts, checked on the server for every request:** the
   capability scope (which terminals and projects a caller can reach) and a
   **permission policy** (which kinds of operation the user allows). Every MCP
   operation, except capability discovery, belongs to one fixed permission
   group. Each group's policy is Ask, Always Allow or Never Allow. The policy
   is a server-owned setting, the same for every caller on the server.
2. **A capability belongs to exactly one calling principal: a terminal or an
   agent chat.**
   - A terminal's scope is decided by the server from its canonical placement
     alone. Automation-space terminals get workspace scope and all others get
     project scope.
   - A chat's scope is the reach recorded on the server's chat record, a
     project or the workspace, fixed when an authorised client created the chat.
   - Only the server's agent chat service can obtain a chat capability. It is
     revoked when the chat's provider session ends, and no caller input can
     select, copy into effect or widen a scope.
3. **Workspace scope widens reach, not powers.** It offers the same tools as
   project scope over every project and the automation space of the same
   server, and never reaches another server. A tool that needs a calling
   terminal (app windows) is unavailable to a chat.
4. **Ask means a server-owned approval** bound to the exact validated request
   and to the calling capability. A terminal caller's approval is presented
   inline with its terminal in every client. A chat caller's approval is
   presented in that chat in every client that shows it. Any client with
   terminal-create authority on the server may decide it. The renderer displays
   approvals and submits decisions, and is never the authority. "Allow This
   Session" is an in-memory grant tied to the capability and dies with it.
5. **MCP may manage automations** server-wide from any scope, subject to the
   policy. It reaches them through an internal MCP principal in the automation
   service, never through the client wire operations.
6. **Unchanged from ADR-0030 via ADR-0031:** the reserved automation space, and
   automation runs executing under a server-internal automation principal.

## Consequences

- Adding a tool still means choosing its permission group. It now also means
  deciding whether the tool needs a calling terminal.
- The trust-boundary review (ADR-0011) gains an invariant for the control-socket
  row: a chat capability is minted only by the server's agent chat service, from
  the chat record, and never in response to a terminal or MCP request.
- Creating a workspace-reach chat requires terminal-create authority, which can
  already open a terminal. A user who sets Full Terminal Management to Always
  Allow lets any such chat type into any terminal on the server without asking.
  The default policies and the full-detail prompt remain the mitigation.
- Approval presentation is keyed on the caller kind. A future non-terminal,
  non-chat caller needs its own surface and a new ADR.
