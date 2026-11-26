## Context

`useTerminalDockviewWindowController` (one per project workspace) adds the `+` and profile-dropdown buttons by querying `.dv-void-container` across the whole window document and appending buttons to any container that lacks them. It runs only while its project is in front, and reconciles on layout changes and every 500 ms. Home renders its own `DockviewReact` inside `.home-tabs[data-terminay-home-tabs="true"]` in the same document and, once shown, stays mounted (hidden) while a project is in front. So while a project is in front, Home's hidden group headers are swept up, and the buttons are there when Home is shown again. The same controller's capture-phase click, double-click and context-menu listeners act on any `.dv-void-container`; they are detached while Home is selected, so the handler guards are defence in depth rather than the visible fix.

## Goals / Non-Goals

**Goals:**
- Home's Dockview never receives the terminal-creation buttons, and Home's empty strip never creates a terminal or opens the profile chooser.
- Project Dockviews are unchanged.

**Non-Goals:**
- Adding any new Home-specific trailing control.
- Changing the project bar's New project `+`, or compact chrome (which draws no panel tab strip).

## Decisions

- **Exclude Home by its container marker, in the controller.** `ensureHeaderButtons` skips any `.dv-void-container` inside `[data-terminay-home-tabs]`, and the click / double-click / context-menu handlers return early for targets inside it. Alternatives considered: (a) scope the query to the controller's own Dockview root element — the controller holds no root element today, and popout windows host groups outside any project root; (b) scope injection and handlers to the headers of the controller's own groups (`api.groups`) across every collected window — the most precise ownership model, but it changes how several mounted project controllers share window-level listeners, a wider behavioural change than this issue warrants. The Home marker already exists (ADR-0040 gives Home its own Dockview) and is what E2E helpers use to find Home.
- **Boundary.** Renderer-only presentation. No Electron privilege, project/window, or terminal-session boundary changes; the fix reinforces the Home/project separation the "Home tabs" requirement already states.

## Risks / Trade-offs

- [Retained limitation: every non-Home Dockview header in the document is still treated as a terminal header, so a future third Dockview host would again receive the buttons] → Accepted for this change. The exclusion lives in one helper whose comment names the limitation, and alternative (b) is the path if another host appears.
- [A negative E2E assertion passing before the 500 ms header reconciliation runs] → The test waits past a reconciliation tick before asserting absence, and counts terminals across all projects after the double-click.
