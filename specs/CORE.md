# Terminay core product specification

## Product

Terminay is a local-first desktop terminal workspace for software projects. It
combines native shell sessions with project-aware tabs, file and Git tools,
automation, AI-agent awareness, recording, and secure browser remote access so
development work can stay in one focused application.

## Core model

- A **project** is a user-facing workspace with a root folder, name, colour,
  icon, sidebar state, and one or more docked panels.
- A **panel** is a terminal, file, or folder surface. Panels can be split,
  reordered, moved between projects, popped into native windows, and adopted by
  another window without losing their identity.
- A **terminal session** is an Electron-owned native PTY. Its immutable session
  ID, not its title or current directory, is the boundary used by activity,
  agents, MCP, recording, and remote access.
- **Settings and macros** persist locally. Credentials use OS-backed secure
  storage where available; recordings and workspace files remain local unless a
  user deliberately shares them.

## Product pillars

1. Fast native terminals and flexible project layouts.
2. Project navigation, file editing/previewing, folder views, and task views.
3. Git worktree awareness and reviewed AI-assisted Quick Push workflows.
4. Automation through macros, dictation, AI tab metadata, and local MCP tools.
5. Clear agent/activity state and optional local terminal recording.
6. Secure, paired remote browser access over LAN HTTPS or isolated WebRTC.

## Architecture boundaries

React in `src/` renders the workspace using Dockview, xterm, Monaco, and the
preload API. Electron in `electron/` owns PTYs, filesystem and Git access,
settings/secrets, recordings, agent hooks, MCP, and remote networking. The
remote client is a separate web surface rooted at `src/remote/`. Renderer code
must not obtain Node/Electron privileges directly.

Each privileged integration scopes requests to the correct window, project, or
terminal session. Remote pairing, MCP capability tokens, and provider hook
events must never widen that scope. Product-specific detail and acceptance
contracts live in the feature specifications listed in [README.md](./README.md).

