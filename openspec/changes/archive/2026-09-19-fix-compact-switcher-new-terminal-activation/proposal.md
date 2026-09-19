## Why

On a compact workspace (phone width, the installed PWA), creating a terminal from the switcher creates it but leaves the terminal the user was already looking at on screen. Reopening the switcher marks the new terminal as current, so the switcher and the screen disagree, and the user has to find and press the new row to reach what they just asked for. The switcher is the only place a compact workspace offers terminal creation, so every new terminal on a phone hits this.

The cause is that both switcher create actions call the project-bootstrap creation path, which asks the server for a session and waits for its panel to be presented but never activates that panel. The new-terminal command everywhere else activates and focuses what it creates.

## What Changes

- **New terminal** in the compact switcher shows and focuses the terminal it created, in the project in front.
- A project group's new-terminal control does the same for that group's project, selecting the project first when it is not in front — including when the project lives on another attached connection.
- The switcher's current-row marking and the terminal on screen name the same terminal after a create.
- Adds end-to-end coverage that fails today: `e2e/compact-chrome-switcher.spec.ts`, "creating a terminal from the switcher shows the new terminal".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: adds the requirement that a terminal created from the compact switcher becomes the active, visible terminal of its project.

## Impact

- `src/App.tsx`: the compact switcher's `onNewTerminal` / `onNewTerminalHere` handlers and the pending cross-server create effect.
- `e2e/compact-chrome-switcher.spec.ts`: new regression test.
- No protocol, server, preload, or Electron main-process change.
