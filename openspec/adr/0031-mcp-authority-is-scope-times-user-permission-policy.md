# ADR-0031: MCP authority is capability scope combined with a user permission policy, and MCP may manage automations behind it

Status: accepted, supersedes ADR-0030
Date: 2026-09-27
Supersedes: ADR-0030

## Context

ADR-0030 put automations in a server-owned terminal space, gave only that
space's terminals a workspace-scoped MCP capability, and committed that
"workspace scope widens reach, not powers ... it never manages automations".
Automations could be created and changed only by authenticated clients with
terminal-create authority.

Users now want agents to manage automations for them ("schedule this every
morning"), from ordinary project terminals as well as from automation runs. They
also want a say over what agents may do. Terminal tab management should stay
frictionless. Anything that creates unattended work should ask first.

Until now the only MCP authority was the capability token's scope: which
terminals a caller may reach. There was no notion of the user's consent per
kind of operation. Every token was minted with the `write` rank, so every tool
was effectively always allowed.

Letting MCP manage automations with scope alone would let any project agent
create an automation whose run terminal holds workspace scope. That is an
escalation from project reach to workspace reach, with nobody in the loop.

## Decision

1. **MCP authority has two parts, checked on the server for every request:**
   the capability scope (unchanged: which terminals and projects a caller can
   reach, minted from canonical placement only) and a **permission policy**
   (which kinds of operation the user allows). Every MCP operation, except
   capability discovery, belongs to one fixed permission group. The groups are
   Read Terminals, Full Terminal Management, Read Automations, and Full
   Automation Management. Each group's policy is Ask, Always Allow, or Never
   Allow. The policy is a server-owned setting, the same for every terminal on
   the server.
2. **Ask means a server-owned approval** bound to the exact validated request
   and to the calling terminal's capability. It is presented inline with that
   terminal in every client, and any client with terminal-create authority on
   the server may decide it. The renderer displays approvals and submits
   decisions. It is never the authority and never a routing hop. "Allow This
   Session" is an in-memory grant tied to the capability and dies with it.
3. **MCP may manage automations**, server-wide, from project and workspace
   scope alike, subject to the policy. The default policy for Full Automation
   Management is Ask. MCP reaches automations through an internal MCP principal
   in the automation service, never through the client wire operations. Those
   operations keep refusing session- or project-bearing claims.
4. **ADR-0030's other decisions stay in force unchanged:** the reserved
   automation space, workspace scope minted from canonical project kind alone,
   workspace scope offering no tool that project scope lacks, and runs executing
   under a server-internal automation principal.

## Consequences

- New MCP surface is governed by a permission group from the moment it exists.
  Adding a tool means choosing its group in the operation table.
- The trust-boundary review (ADR-0011) gains two invariants for the control
  socket row. First, the permission policy is evaluated server-side from stored
  settings and capability-bound grants only. Second, an approval executes only
  the request it displayed.
- A project agent granted Full Automation Management can indirectly obtain
  workspace reach through an automation run. The default of Ask and the
  full-detail prompt are the mitigation, and Settings must say so.
- The policy is a guardrail on Terminay's own surface, not a sandbox. An agent
  with shell access can still schedule work outside Terminay.
- Control requests waiting on an approval are bounded by the approval's
  lifecycle instead of a timer. The endpoint's concurrency limits and a
  per-terminal approval queue bound keep that from exhausting the socket.
