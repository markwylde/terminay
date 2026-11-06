## Why

The Home overview is six identical grey boxes holding a number and a word. It cannot be rearranged or trimmed. Bots, workflows, notifications, recordings, and pull requests do not appear on it at all, so you still have to open each section to find what needs you. The cards look alike, so nothing on the page stands out, not even the one item that needs you.

## What Changes

- Add an **Edit** mode to the Home overview. You can show or hide each widget, drag widgets (or move them with buttons) into a new order, pick a size for each (small, wide, or tall), add hidden widgets back from a tray, and reset to the default layout.
- Store the layout as a **server setting** (`homeDashboard`) on the server the window is working in. Every device connected to that server shows the same dashboard. This setting is not reachable by MCP.
- Add these widgets:
  - **Needs you**: one list of everything waiting on the user. That covers agents in Needs you, bot sessions waiting on a decision, and workflow steps that need input or have failed.
  - **Bots**: each bot's activity and environment, with the next trigger firing.
  - **Bot sessions**: the most recent sessions across bots.
  - **Workflows**: running workflows with their progress dial, current step and elapsed time, plus recently finished ones.
  - **Run history**: a bar strip of recent automation runs coloured by outcome, with the success rate.
  - **Notifications**: the published notifications, each openable and dismissable.
  - **Recordings**: the most recent recordings.
  - **Pull requests**: open pull requests from the folders that hold panels, with their check counts.
  - **Quick actions**: New project, New bot, New automation, Command Bar, Settings.
- Rework the existing widgets. Agents becomes a status ring with a legend. Projects becomes a list of projects with their colour, emoji, and per-status counts.
- Refresh the visuals. Each widget gets its own accent colour and a tinted icon chip, headline numbers are larger, empty states are clear, and an item that needs you is emphasised.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`:
  - "Home overview section" expands to the new widget catalogue, partial multi-server coverage, and resolution at activation time.
  - "Home is a selectable view" names the overview layout as Home's only server-owned state.
  - New requirements define the Needs you, Workflows, Pull requests, Run history, and Recordings widgets; customising; strict grid order; layout storage and resolution; and what happens when a save fails.
- `settings-shortcuts-and-desktop-integration`: "Settings classification by authority" names the Home overview layout as a server setting.

## Impact

- `src/workspace/homeDashboardLayout.ts` (new): the widget catalogue, default layout, normalisation, and edit operations, kept pure so they can be unit-tested.
- `src/workspace/homeOverviewModel.ts`: adds bots, workflows, attention, notifications, pull requests, and run-history summaries.
- `src/workspace/HomeOverview.tsx`, `src/workspace/homeOverviewWidgets.tsx` (new), `src/workspace/homeOverview.css` (new): the widgets, the edit mode, and the styling.
- `src/types/settings.ts`, `src/terminalSettings.ts`, `packages/server-core/src/settings/classification.ts`, `defaults.ts`: the `homeDashboard` server setting.
- `src/App.tsx`: wires the bots, workflows, notifications, and recordings data and the layout persistence into the overview.
- E2E: `e2e/` Home overview suite.
- No protocol change: every widget reads state the window already receives, apart from recordings, which uses the existing `recordings.list` query.
