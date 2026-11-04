## Why

A user who drives an agent through the same multi-step routine (propose, review, fix, apply, review, test, archive, open a green pull request) has to paste or retype each prompt in turn and keep track of where the agent is. Nothing in Terminay shows how far the agent has got, so the user has to read the scrollback to find out. If the agent's session is compacted, crashes, or Terminay restarts, the agent forgets where it was in the routine.

Agents can already follow a list of steps well when given one. They need somewhere durable to read that list from and report progress to, and a way for the user to start a routine in one action. Terminay does not need to run the steps itself.

## What Changes

- **Workflow templates**: named, ordered lists of steps, each with a title, a prompt, and an optional icon, plus a name, description, category, and an opening prompt that sets context for every step. They are managed in **Settings › Automation › Workflows** with the same library model as macros: categories, filtering, drag-and-keyboard reordering, and an unsaved marker. Templates are server-owned, revisioned state.
- **Workflows attached to a terminal**: a server-owned record bound to one terminal session. It holds a copy of a template's steps (or steps an agent supplied), each with a stable id, a status (not started, running, done, failed, needs input), an optional one-line note, and start and end times. It lasts as long as its terminal session and survives a server restart while that session keeps running.
- **Workflow panel** at the right edge of a terminal's pane, inside the pane and not part of either sidebar. Collapsed, it is a thin rail of status-coloured step markers showing each step's icon. Expanded, it adds the workflow name, progress, elapsed time, a collapsible brief holding the opening prompt, and step titles and durations. Whether it is collapsed or expanded is a device-local user setting, not part of a template.
- **Launching from the Command Bar**: workflow templates appear in the Command Bar grouped by category in their saved order. Choosing one attaches a new workflow to the active terminal with every step not started, then types a `/goal` made of the opening prompt and a fixed instruction to work through the attached workflow, and submits it.
- **Resume**: when the active terminal's workflow is unfinished, the Command Bar offers **Resume workflow** first. It types a `/goal` telling the agent to read the workflow back and continue from its resume point: the step left running or waiting on the user if there is one, otherwise the first step that is not done.
- **MCP tools** `create_workflow`, `get_workflow`, and `update_workflow_step`, which act only on terminals in the caller's reach. An agent can create a workflow from steps it writes itself, read the attached workflow (including every step's prompt), and report each step's status and note.

## Capabilities

### New Capabilities

- `terminal-workflows`: workflow templates and their Settings library, workflows attached to terminal sessions and how long they last, the in-pane workflow panel, launching and resuming from the Command Bar, and the workflow MCP tools' behaviour.

### Modified Capabilities

- `mcp-permissions`: the permission-group table gains the three workflow tools.
- `settings-shortcuts-and-desktop-integration`: the Command Bar's contents include workflow templates and the Resume command.
- `server-owned-workspace-state`: the server-persisted state inventory includes workflow templates and the workflows of running terminal sessions.

## Impact

- **Server** (`packages/server-core`): a new workflow service with a template repository (following `macroService` revisioned state), a per-session workflow record store persisted one canonical file per terminal session under the data root (lifetime following app window records, ADR-0076; durability following ADR-0088 canonical state), protocol operations for templates, launching, resuming, and removing a workflow, and change publication to clients.
- **MCP** (`apps/terminay-server/src/mcp`): new operations in `CONTROL_OPERATIONS`, a parser module and an adapter like `macroTools.ts` and `macroAdapter.ts`, entries in the operation table, the stdio tool registration, and capability reporting.
- **Client** (`src/`, `packages/client-core`): the workflow panel in `TerminalPanel`, which narrows the terminal viewport the way the app-window rail does; the Workflows category in Settings; Command Bar groups and the Resume command; and the device-local panel setting.
- **Tests**: unit tests for normalisation, bounds, status rules, and MCP parsing; server tests for persistence and session lifetime; and end-to-end coverage through `npm run test:e2e`.
- No new dependency. No change to existing macro or automation behaviour.
