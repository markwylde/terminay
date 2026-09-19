## Context

The compact switcher (`src/workspace/CompactSwitcher.tsx`) exposes two create actions, wired in `src/App.tsx`:

- `onNewTerminalHere` → `createInitialTerminalForProject(activeProjectId)`
- `onNewTerminal(group)` → `createCompactSwitcherTerminal(group)` → `activateProject` + `createInitialTerminalForProject(group.projectId)`, with a `pendingCompactTerminalRef` effect that does the same once another server's binding lands.

`createInitialTerminalForProject` exists to give a freshly created project its first terminal. It calls `terminalClient.create`, waits for the workspace snapshot and for the panel's xterm to mount, and returns. It never calls `panel.api.setActive()`. For a new project that is invisible, because the only panel in a Dockview group is the active one. For a project that already shows a terminal, the new panel joins the group behind the current one.

Every other creation route goes through the project workspace's `useTerminalCreationController` (`addTerminal`), reached by `executeCommand('new-terminal')` on the workspace handle. That path passes the active panel to the server, then `activateCreatedTerminalPresentation` sets the new panel active and schedules terminal focus, and it carries the recording, agent-scope and initial-activity handling that creation is supposed to have.

The switcher's current-row marking is derived from the panel inventory, which follows the server's view of the active panel, so it names the new terminal while Dockview still shows the old one.

## Goals / Non-Goals

**Goals:**

- A terminal created from the compact switcher is shown and focused, for the project in front, a background project, and a project on another attached connection.
- One definition of what "new terminal" means in a project.

**Non-Goals:**

- Changing `createInitialTerminalForProject` for its project-bootstrap caller.
- Changing the switcher's layout, rows, or current-row derivation.
- Any server, protocol, preload, or Electron main-process change.

## Decisions

### Switcher create actions dispatch the project's own new-terminal command

Both handlers call `workspaceRefs.current.get(projectId)?.executeCommand('new-terminal')` instead of `createInitialTerminalForProject`. For a project that is not in front, `activateProject` runs first and the command is dispatched on the next animation frame, the same ordering `activateTerminalFromOverview` already uses. The pending cross-server effect does the same once the project arrives.

Alternative considered: keep `createInitialTerminalForProject` and activate the panel it returns via the handle's `activateTerminal`. Rejected — it fixes the symptom but keeps a second creation route that skips recording defaults, agent session scope admission, and initial-activity suppression, which is how this bug came to exist.

Alternative considered: make `createInitialTerminalForProject` activate what it creates. Rejected — its contract is bootstrap for a project with no panels, and its caller holds the active project deliberately while a project is being created.

Boundary: this stays inside the renderer presentation. It crosses neither the preload/Electron privilege boundary nor the project/terminal-session boundary: the command runs on the workspace handle of the owning project and creates through that project's server client, as the command bar and accelerator already do.

### The workspace handle may not be mounted yet

After a cross-server activation, the project's workspace may mount a frame or more after `projects` contains it. The dispatch retries on animation frames until the handle exists, bounded (about one second, matching `activateCreatedTerminalPresentation`), and gives up silently past that; the user is left in the right project with the switcher one press away.

## Risks / Trade-offs

- [The command path assumes an existing active panel for placement] → `addTerminal({})` already handles an empty Dockview; the e2e run covers the populated case and the existing project-creation tests cover the empty one.
- [Focus on a phone raises the soft keyboard after create] → That is what the new-terminal command does everywhere else and what the spec asks for; the switcher's create is an explicit request for a terminal to type in.
- [e2e asserts row order to identify the new terminal] → Rows follow panel order and a new panel is appended; if that ever changes the assertion should move to a session-id attribute on the row.
