# ADR-0029: Automations run in a server-owned terminal space outside every project, and only that space holds workspace-scoped MCP

Status: accepted
Date: 2026-09-24

## Context

Automations are server-owned rules that run commands when a schedule comes due
or a Terminay event fires. Users want them to act on the whole workspace, for
example "every hour, spawn an agent for each pull request with merge conflicts",
and to keep working when no project is open. Projects open and close all the
time, so an automation cannot live in one.

Two existing commitments collide with that:

- Every terminal belongs to a project. The workspace model requires a project
  for every panel and session, and environment routing, recording metadata,
  activity keying, and MCP token resolution are all keyed by project id.
- The project is the MCP security boundary (ADR-0011, the local control socket
  row). A token resolves to one project, and no MCP caller can learn about
  another project.

The options considered:

- **A session kind with no project.** This removes the project assumption from
  every boundary at once. It is the largest and riskiest change to security
  checks that work today.
- **Pick a project to host the automation.** This contradicts the product model
  and breaks when that project closes.
- **A reserved, server-owned project kind that is never presented as a
  project.** Every existing check keeps working unchanged, and one filter is
  added at the presentation edge.

For MCP, a script that spawns work across projects needs to list and open
terminals beyond its own terminal's project. Widening project scope for everyone
is out of the question. Deriving a wider scope from anything a caller controls
(title, cwd, environment variables) is forbidden by ADR-0011.

## Decision

1. **Each server has one reserved project of kind `automations`.** It is the
   automation terminal space, created by the server on first use. It executes
   only in the server's local environment. It can never be selected, closed,
   renamed, reordered, or listed as a project, and it is withheld from
   connections that did not negotiate the automations capability.
2. **A terminal's MCP scope is decided by the server from that terminal's
   canonical project kind alone.** Terminals in the automation space get a
   *workspace* scope over every project and the automation space on the same
   server. All other terminals keep project scope exactly as before. No caller
   input can select or widen scope.
3. **Workspace scope widens reach, not powers.** It offers the same terminal
   tools as project scope and nothing else. It never reaches another server, and
   it never manages automations. Automations are created and changed only by
   authenticated clients with terminal-create authority.
4. **Automation runs execute under a server-internal automation principal**,
   audited per run. They never borrow a connected client's identity.

## Consequences

- Automations, recording, activity tracking, and MCP reuse the existing
  project-keyed machinery with no changes to their boundary checks.
- Every presentation of "projects" must exclude the reserved kind. Missing that
  filter is a correctness bug that the tests have to catch, and a single helper
  is the choke point.
- The trust-boundary review gains one row: an automation-space terminal holds a
  workspace-scoped control token. Its protected assets are every project's
  terminals on that server. The invariant is that the scope is minted only from
  canonical placement, is bound to its minting terminal, and is revoked when
  that terminal exits.
- A leaked workspace token is worth more than a project token. Run terminals
  close by default, which keeps those tokens short-lived.
- A future feature that needs non-project terminals (for example, server
  maintenance shells) should reuse the reserved-kind pattern rather than
  introduce projectless sessions.
