## Context

Two surfaces already describe the same running agents, and they describe them
from different data.

`AgentsSidebar` is given `AgentsSidebarItem`s built inside `ProjectWorkspace`
from `agentStatusSnapshot` — the live agent projection — plus the Dockview
panel titles. It resolves a display name from the entry's `displayName`, the
terminal title, and the prompt, folds provider and model into a metadata line,
and nests subagents under their root by `parentEntryId`.

`WorkspaceDashboard` is given `DashboardServerSource`s built in `App` from
`inventoryByProject` — the panel inventory. An inventory entry carries panel
identity, title, colour, emoji, kind, and a canonical status, and one boolean,
`isAgentStatus`, saying that the status came from an agent. It carries nothing
about *which* agent, so the dashboard cannot say more than the dot already says.

Both data sources are already in `App`'s scope at the point the dashboard's
sources are assembled: `agentStatusSnapshot` for the server being worked in,
and `useConnectionAgentSnapshots` — which `useCrossServerAgentBadges` calls
today for the tab badges — for every attached server.

## Goals / Non-Goals

- Goal: the dashboard says as much about an agent as the sidebar does, for
  every attached server.
- Goal: one name resolver, so the same agent reads the same way everywhere.
- Goal: three shapes over one model, so a view mode is a rendering choice and
  never a different set of facts.
- Non-Goal: any new server-side projection, protocol message, or persistence.
  Everything here is assembled in the renderer from projections it already
  subscribes to.
- Non-Goal: acting on an agent from the dashboard. Rows stay navigation only,
  exactly as the current row-activation requirement says.

## Decisions

### The dashboard composes a tree, and the list view flattens it

`buildDashboardRows` returns a flat project-then-panels row list because that
is what one view needed. Two of the three views group by something else, so the
row model becomes a tree — `DashboardProjectGroup { project, panels[] }`, each
panel carrying `agents[]` — and the flat row list is derived from it.

Deriving one from the other rather than building both means a filter, a count,
or a status can only be computed once. A card and a row are then guaranteed to
agree, because there is nothing for them to disagree from.

### Agents attach to panels by activation terminal session

An inventory entry for a terminal panel carries `sessionId`. An agent entry
carries `activationTerminalSessionId`. That pair is the join, and it is the
same join the terminal tab already uses to decide that a tab is under agent
authority — so a panel whose status reads as an agent state is exactly the
panel that gets agent detail, with no second notion of ownership.

For a server the window is not working in there is no panel inventory, so its
agents are grouped by the project its workspace projection assigns to the
activation terminal session — the mapping `useCrossServerAgentBadges` already
uses to badge that server's tabs. Those agents are shown under their project as
agent entries without a panel: the dashboard says the agent exists and which
project it is in, which is all that is true across a server boundary.

Subagents are never top-level. They nest under their root entry by
`parentEntryId`, as they do in the sidebar, and a root's card states its
subagent count rather than spilling one card per subagent into a column.

### Naming is one module, not two copies

`meaningfulDisplayName`, `providerLabel`, `isGenericTerminalTitle`, and the
`uniqueParts` metadata join move out of `AgentsSidebar.tsx` into
`src/agents/agentPresentation.ts`, which both surfaces import. The sidebar's
resolved output is unchanged; this is a move, and the sidebar tests pin that.

The alternative — letting the dashboard resolve its own name — is what produces
the bug where a workspace calls the same agent `Claude Code` in one place and
`Isolate *.paged.net tenants` in another.

### The view mode is per-device presentation state

Which shape a device shows Home in is the same kind of fact as which tab it has
selected: it belongs to the person at the screen, not to the workspace. It goes
in `localViewState.ts` next to the remembered Home selection, under its own
key, with the same best-effort persistence — unreadable or disabled storage
falls back to List and reports nothing.

It is stored per device rather than per server because Home spans every
attached server. There is no one server whose key it could hang from.

## Boundaries

Nothing here crosses a privileged boundary. The dashboard is renderer code in
the shared workspace bundle (ADR-0018); it reads projections the renderer is
already subscribed to over the existing connection, adds no filesystem, PTY,
or Git access, and sends nothing to any server. Per ADR-0011 the prompt text,
agent display names, and model identifiers it now renders are untrusted
provider-supplied strings: they are already sanitized and bounded at the
transport boundary, and they are rendered as text, never as markup.

Per ADR-0017 and the project/server boundary, no row is merged across servers.
Every card and row keeps the server that owns it, keyed by `(serverId, rowKey)`
as the existing cross-server row scoping already requires, and a summary count
is a sum over rows that each still belong to exactly one server.

## Risks / Trade-offs

- **The Board view can hide a project.** A kanban groups by status, so a
  project with nothing in a column does not appear in it. The dashboard's
  "never omit a project because nothing is happening" rule is therefore stated
  against the List and Projects views, which are the two that inventory the
  workspace; the Board is explicitly a triage view and says so. List stays the
  default, so a device that never touches the switcher keeps today's contract.
- **Filter text can empty a view.** Each view states that its filter is active
  and offers to clear it, so an empty screen is never mistaken for an empty
  workspace.
- **More renderer work per snapshot.** The tree is rebuilt whenever the
  inventory or any agent snapshot changes, which is as often as today's rows
  are. It is a single pass over panels and agents with no per-row subscription,
  and it is memoized on the same inputs the current row build is.
