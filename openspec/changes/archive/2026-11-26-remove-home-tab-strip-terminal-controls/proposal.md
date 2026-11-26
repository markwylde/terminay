## Why

Home's tab strip shows a `+` (New terminal tab) button and a `⌄` (New terminal with profile) dropdown at its trailing end, as a project's panel tab strip does (issue #658). Home holds sections, bots, automations and other Home tabs, never terminals, so those controls are meaningless there and do nothing when pressed. Technically, while a project is in front its controller injects the controls into every Dockview header in the document, including Home's, which stays mounted behind the project, so they are there when Home is shown again.

## What Changes

- Home's tab strip carries no `+` New terminal tab button and no New terminal with profile dropdown, in every Home group, including groups made by arranging Home tabs side by side or stacked.
- Double-clicking empty space in Home's tab strip does not create a terminal.
- Project panel tab strips keep both controls and the double-click-to-create behaviour exactly as today.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-dashboard`: Home's tab strip carries no terminal-creation controls (new requirement alongside "Home tabs").

## Impact

- `src/workspace/useTerminalDockviewWindowController.ts`: header-button injection and the header click / double-click / context-menu handlers skip Home's Dockview (`[data-terminay-home-tabs]`).
- `e2e/home-tabs.spec.ts`: covers the absence of both controls on Home and their presence on a project strip.
- No API, preload, server, or persisted-state change.
