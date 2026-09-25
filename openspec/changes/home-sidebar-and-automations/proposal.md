## Why

Home shows every project and tab at a glance, but it is a single view and
nothing else can live there. Meanwhile the things a user wants Terminay to do
*for* them have nowhere to live at all: "text me when something needs me",
"count every agent that finishes", "every hour, spawn an agent for each pull
request with merge conflicts". None of these belongs to a project — projects
open and close all the time, and a workspace may hold nothing but one empty
project — so they cannot be modelled as anything a project owns.

Home is the one place in the workspace that is not a project. Giving it a
sidebar makes it the natural home for workspace-wide things: an overview, the
existing tab dashboard, and a new concept, Automations.

## What Changes

- The Home control shows a house glyph instead of the dashboard-grid glyph.
- Home gains a sidebar that works as a menu with three sections: **Home**
  (overview widgets), **Tabs** (today's dashboard, with its List, Board, and
  Projects views unchanged), and **Automations**.
- The sidebar toggle on the project bar works while Home is selected and toggles
  Home's own sidebar. Home's sidebar is open the first time on a device, then
  its visibility and selected section are remembered per device.
- The **Home** section shows counts of open projects, open tabs and terminals,
  agents by state, remote connections and devices, active automations with the
  next scheduled run, and recent automation runs.
- New: **Automations** are server-owned, workspace-wide rules of the form
  *trigger → action*. They belong to a server, never to a project.
  - Triggers: a **schedule** (cron expression, with presets such as every
    minute, hour, day, or weekday), or a **Terminay event**: agent moved to
    Done, to Needs Me, or to a fault; terminal command finished; terminal went
    idle; project opened or closed; remote device connected.
  - Actions: **run a command** in a terminal that the automation owns, outside
    every project, shown in the Automations section. The event's context is
    passed to the command as environment variables. For an event whose subject
    is a terminal, an automation may instead **run a Macro** on, or **write
    text** into, that terminal.
  - Commands launched by an automation get a Terminay MCP scope that spans the
    whole workspace, so a scheduled script can find and spawn terminals and
    agents across projects. Project terminals never get this scope.
  - Each automation has an explicit enabled switch, a loop guard that stops it
    re-firing on the terminal it just acted on, a "keep terminal after run"
    setting (off by default, so run terminals close when they exit), and an
    optional "record session" setting that uses the existing recording feature.
  - Every run is kept in a bounded run log: trigger, subject, outcome, exit code,
    duration, and the tail of the output.
  - Schedules missed while the server was down are skipped, not caught up. On
    the next attach the user sees a short, non-alarming notice listing them,
    with a button to run each one now.

## Capabilities

### New Capabilities

- `automations`: server-owned trigger → action rules — schedules, event
  triggers, actions, the automation terminal space, the workspace MCP scope,
  loop guard, run log, missed-run notice, and the Automations editor.

### Modified Capabilities

- `workspace-dashboard`: Home gains a device-remembered sidebar menu with Home,
  Tabs, and Automations sections; the existing dashboard becomes the Tabs
  section; Home gets an overview section; the Home control uses a house glyph.
- `mcp-server`: a terminal launched by an automation gets a workspace-wide MCP
  scope instead of a project scope.

## Impact

- Server (`apps/terminay-server/`): an automation repository (revisioned, like
  macros), a scheduler, an event subscriber over the agent, terminal activity,
  project, and remote-device sources, an automation terminal space that is not a
  project, a run log, and a new MCP scope.
- Protocol (`packages/protocol/`): automation, run-log, and missed-run messages
  with client subscription.
- UI (`src/`): Home sidebar and section routing in `App.tsx` and
  `src/workspace/`, the overview widgets, the Automations list and editor with a
  schedule builder, the missed-run notice, and the House glyph in the project
  bar and `CompactChromeRow.tsx`.
- Dependency: a cron expression parser for the server and the editor preview.
- Security: automations run commands with no one at the keyboard and widen the
  MCP scope, so they cross the project boundary on purpose. The ADR records that
  decision.
- Sequencing: `dashboard-board-group-by-project` also modifies
  `workspace-dashboard`. This change leaves that change's requirements alone.
- Scope history: the answered questionnaire is in `questionnaires/scope.yaml`.
  Its action list was revised later in conversation into the action model above.
