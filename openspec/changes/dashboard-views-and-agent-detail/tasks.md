## 1. One shared agent presentation rule

- [x] 1.1 Add `src/agents/agentPresentation.ts` holding `providerLabel`,
      `meaningfulDisplayName`, `isGenericTerminalTitle`, `joinMetadata`, and
      `resolveAgentPresentation`, lifted unchanged from `AgentsSidebar.tsx`.
      Verified by `scripts/agent-presentation.test.mjs` covering the untitled
      root, the generic terminal title, the provider-equals-name case, and the
      subagent fallback.
- [x] 1.2 Make `AgentsSidebar.tsx` import the resolver instead of defining it.
      Verified by the sidebar rendering the same names as before in
      `e2e/agent-status-sidebar.spec.ts`.

## 2. The dashboard model carries agents

- [x] 2.1 Extend `dashboardRows.ts` with `DashboardAgent` and
      `DashboardProjectGroup`, and add `buildDashboardGroups(projects,
      inventoryByProject, agentsBySession, orphanAgentsByProject)` joining an
      agent to its panel on `activationTerminalSessionId` and nesting subagents
      under `parentEntryId`. Verified by `scripts/workspace-dashboard-rows.test.mjs`
      asserting the join, the nesting, the subagent counts, and that a subagent
      never appears at top level.
- [x] 2.2 Derive `buildDashboardRows` from the groups so the List view and the
      card views cannot disagree. Verified by the existing row-order and
      activation tests continuing to pass unchanged.
- [x] 2.3 Add `summarizeDashboard(groups)` returning the per-status totals over
      panels and agents. Verified by a test asserting counts over a mixed
      workspace, including that a subagent is counted once through its root.
- [x] 2.4 Carry each server's agents on `DashboardServerSource` in
      `crossServerRows.ts` and scope groups by server. Verified by a test that
      two servers with equal project ids produce distinct keys and unmerged
      groups.

## 3. View modes, summary, and filter

- [x] 3.1 Add `src/workspace/dashboardViewMode.ts`: the `list | board |
      projects` vocabulary, the four Board status columns, and the mapping from
      a canonical status to its column. Verified by a test asserting every
      `AgentState` lands in exactly one column.
- [x] 3.2 Add `src/workspace/dashboardFilter.ts`: a case-insensitive predicate
      over project name, panel title, agent name, provider, model, and prompt,
      keeping a project when it matches or when anything it holds matches.
      Verified by a test covering a match on each field, a project kept by a
      descendant, and empty text keeping everything.
- [x] 3.3 Add `rememberDashboardViewMode` / `recallDashboardViewMode` to
      `localViewState.ts`, best-effort and defaulting to List. Verified by
      `scripts/local-view-state.test.mjs` covering the round trip, an unknown
      stored value, and storage that throws.

## 4. The dashboard renders

- [x] 4.1 Rebuild `WorkspaceDashboard.tsx` around the groups: a header with the
      summary bar, the filter input, and the mode switcher, then the List,
      Board, or Projects view. Verified by typecheck and by the e2e suite.
- [x] 4.2 Render agent detail — name, provider · model, prompt, state, unread,
      subagent count, time in state — on rows and cards. Verified by rendering
      all three views against a fabricated multi-project, multi-provider agent
      roster and reading the result: the agent's own name replaces `Terminal 1`,
      the prompt and the waiting reason are legible, and nothing is repeated
      between the name and the detail beside it.
- [x] 4.3 Extend `workspaceDashboard.css`: one-line rows unchanged for List,
      responsive card grids for Board and Projects, every field truncating.
      Verified by narrowing the window in the running app and by the e2e
      narrow-window assertions.
- [x] 4.4 Keep `data-terminay-dashboard`, `data-terminay-dashboard-project`,
      `data-terminay-dashboard-panel`, and `data-terminay-dashboard-status` on
      the List view, and add `data-terminay-dashboard-view` and
      `data-terminay-dashboard-agent`. Verified by the existing e2e selectors
      still resolving.

## 5. Wiring

- [x] 5.1 Subscribe once to `useConnectionAgentSnapshots` in `App.tsx`, derive
      the cross-server tab badges from it, and feed the same snapshots to the
      dashboard sources. Verified by typecheck and by the tab badges being
      unchanged in the running app.
- [x] 5.2 Build `agentsBySession` from the current server's
      `agentStatusSnapshot` and `orphanAgentsByProject` from the other servers'
      snapshots via `projectForSession`. Verified in the running app with two
      attached servers, each showing its own agents.
- [x] 5.3 Resolve an agent activation through the existing
      `resolveDashboardActivation`, so a stale agent is as safe as a stale row.
      Verified by an activation test over a removed panel.

## 6. Specification and verification

- [x] 6.1 Register `scripts/agent-presentation.test.mjs` in `smoke`. Verified by
      the script appearing in the command.
- [x] 6.2 Extend `e2e/workspace-dashboard.spec.ts` with switching to Board and
      Projects, activating a card, and filtering to nothing. Verified by
      `npm run test:e2e` passing.
- [x] 6.3 Run `npx openspec validate dashboard-views-and-agent-detail --strict`.
      Verified by the command reporting the change valid.
- [x] 6.4 Run `npm run lint`, `npm run typecheck`, and the touched unit suites.
      Verified by all commands exiting zero.
- [ ] 6.5 Open the pull request with the change branch and confirm CI is green.
      Verified by the PR checks passing.
