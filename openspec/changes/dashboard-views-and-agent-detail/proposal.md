## Why

The dashboard is the one screen that answers "what is running, and what is
waiting on me?" — and today it answers it worse than the sidebar sitting inside
a single project.

Open a project and the Agents sidebar tells you the agent's name, the prompt it
is working on, its provider and model, its subagents, and whether its result is
still unread. Leave that project for Home and all of that is thrown away: every
terminal collapses to a title and a coloured dot. A workspace with eight agents
across four projects renders as thirty grey rows that say `Terminal 1`,
`Terminal 2`, `Terminal 3`. The screen built to survey the workspace is the one
that knows least about it.

It is also a single fixed shape. A flat alphabet of every panel is the right
shape for auditing what exists, and the wrong shape for the question people
actually bring to Home, which is triage: what needs me, what is running, what
finished. That question wants columns, not a list.

And the agent detail is not even reachable for most of the workspace: a window
attached to more than one server shows the other servers' project headers with
no panels under them at all, even though each of those servers publishes an
agent projection this window is already subscribed to.

## What Changes

- The dashboard reads the agent projection of every attached server, not just
  the panel inventory of the one being worked in. A terminal under agent
  authority carries its agent's resolved name, prompt, provider, model,
  subagents, unread flag, and how long it has held its current state.
- Agent naming moves to one shared resolver used by both the Agents sidebar and
  the dashboard, so an agent is never called two different things on two
  surfaces.
- The dashboard gains three view modes over one model, chosen from the header
  and remembered per device:
  - **List** — today's one-line-per-row inventory, now carrying agent detail.
  - **Board** — a kanban by canonical status: Needs you, Working, Done, Idle.
    One card per agent, or per panel where no agent owns it.
  - **Projects** — one card per project holding its own panels and agents.
- A summary bar states the workspace totals per status, and a filter box
  narrows every view by project, panel, agent, model, or prompt text.
- Rows and cards activate identically: the same project selection, panel focus,
  and stale-row resolution, from whichever view they were clicked in.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: the row model carries agent detail and covers every
  attached server's agents; the single-unwrapped-line rule becomes the List
  view's contract rather than the dashboard's; new requirements for view modes,
  agent detail, and the summary and filter.
- `agent-status-and-sidebar`: agent display naming is a shared resolver the
  sidebar and the dashboard both read, rather than sidebar-private logic.

## Impact

- `src/agents/agentPresentation.ts` — new: the shared name, metadata, and
  prompt resolver lifted out of the sidebar.
- `src/workspace/dashboardRows.ts` — the row model gains agent detail and a
  project-grouped tree the card views render.
- `src/workspace/dashboardViewMode.ts` — new: the view-mode vocabulary and the
  status columns the Board view uses.
- `src/workspace/dashboardFilter.ts` — new: the filter predicate over the tree.
- `src/workspace/crossServerRows.ts` — sources carry each server's agents.
- `src/workspace/WorkspaceDashboard.tsx`, `workspaceDashboard.css` — the header
  controls, the summary bar, and the three views.
- `src/workspace/localViewState.ts` — the remembered view mode.
- `src/components/AgentsSidebar.tsx` — reads the shared resolver.
- `src/App.tsx` — one agent-snapshot subscription feeding both the cross-server
  tab badges and the dashboard sources.
- Tests: `scripts/workspace-dashboard-rows.test.mjs`,
  `scripts/local-view-state.test.mjs`, `e2e/workspace-dashboard.spec.ts`.
