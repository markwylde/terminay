# ADR-0074: A terminal's MCP capability follows it between projects, and a move never widens it

Status: accepted
Date: 2026-10-25

## Context

A terminal's MCP capability token reaches the shell once, through its launch
environment, which cannot be updated after launch. Moving a terminal to another
project revoked the capability, and nothing could put a new token into the
running shell. A moved terminal therefore lost MCP for good: agents already in
it, and agents started later, failed with `invalid_token`.

ADR-0011 requires tokens to resolve to immutable server/project/session state
and to derive the implicit project from the server-owned session. ADR-0030,
carried through ADR-0031, ADR-0068, and ADR-0072, derives reach only from
canonical placement. ADR-0072 reserves cross-project terminal moves for
workspace reach.

## Decision

1. A capability is bound immutably to its terminal session. Its project and
   reach are those of the session's current canonical placement.
2. When a terminal moves project→project, or automation space→project, its
   capability is re-scoped in place under the same token. The re-scope is
   atomic, so no instant has both scopes valid, and it ends every approval,
   session grant, and in-flight request held under the old scope.
3. A move never widens a capability. Moving a terminal into the automation
   space revokes its capability instead of granting workspace reach.

## Consequences

- MCP survives a project move without a token exchange or any new endpoint
  surface.
- Anyone reviewing a move-related change checks two things: per-scope state
  ends at the move, and the move cannot widen reach.
- Re-entering workspace reach always requires a newly launched automation-space
  terminal.
