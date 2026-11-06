## 1. Setting

- [x] 1.1 Add `homeDashboard` to `TerminalSettings` (`src/types/settings.ts`), with its default `{ widgets: [] }` and its normaliser in `src/terminalSettings.ts`, and list it as server-owned. Classify it `server` in `packages/server-core/src/settings/classification.ts` with a default in `defaults.ts`, and keep it off the MCP allow-list. Verify: unit tests for normalisation (malformed entries dropped, duplicates collapsed, unknown ids kept), and a server-core test that the path is server-classified and not MCP-reachable.

## 2. Layout model

- [x] 2.1 Add `src/workspace/homeDashboardLayout.ts` with the catalogue (including each widget's allowed sizes), `resolveLayout`, `moveWidget`, `setWidgetSize`, `setWidgetHidden`, `resetLayout`, and a serial save queue with rollback. Verify: unit tests for default resolution, appended new widgets, unknown ids preserved through edits, unsupported sizes falling back per widget, moves at both ends and across hidden widgets, reset, and the save queue's ordering, last-write-wins, and rollback on rejection.

## 3. Overview model

- [x] 3.1 Extend `buildHomeOverview` with bots, bot sessions, workflows, attention, notifications, pull requests, and run-history summaries. Verify: unit tests for:
  - attention ordering across kinds and groups
  - workflow ranking and the current-step fallback
  - pull-request dedupe by folder, draft and merged handling, and "No checks"
  - the run success-rate denominator
  - equal ids on two servers
  - not-held servers for workflows and pull requests

## 4. UI

- [x] 4.1 Rewrite `HomeOverview.tsx`, with one component per widget in `homeOverviewWidgets.tsx` and styles in `homeOverview.css`. Cover accents, icon chips, the agent ring, the run strip, workflow dials, and edit mode (drag, move buttons, size picker, hidden tray, reset, save-failure notice). Use a strict-order grid. Verify: typecheck, Biome, and e2e.
- [x] 4.2 Wire bots, workflows, notifications, recordings, quick actions, and layout persistence into `App.tsx`. Verify: e2e activates a workflow, a notification, and a run from Home, and quick actions reach their destinations.

## 5. End to end

- [x] 5.1 Extend the Home overview e2e suite to cover:
  - customising: hide, add back, move, resize, and reset
  - the layout surviving a reload (server-persisted)
  - strict order with mixed sizes
  - the Recordings widget's states
  - the new widgets rendering

  Verify: `npm run test:e2e` for the suite passes in Docker.
- [x] 5.2 Run typecheck, unit tests, Biome, `openspec validate customisable-home-dashboard`, and `openspec validate --all`. Verify: this change passes. Report failures in other in-flight changes separately.
