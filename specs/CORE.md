# Terminay core product specification

## Product

Terminay is a local-first, server-backed terminal workspace for software
projects. It combines native shell sessions with project-aware tabs, file and
Git tools, automation, AI-agent awareness, recording, and secure remote access
so development work can stay in one focused application.

A Terminay Desktop installation includes Terminay Server for local use. The
same server runs headlessly on another workstation, VPS, or dedicated machine.
Desktop and browser clients connect to one selected server and render the
complete responsive workspace UI bundled by that server.

## Core model

- A **server** is one machine authority, data root, trust domain, and collection
  of durable workspace state.
- A **server connection** is an authenticated relationship between a client
  device and one local or remote Terminay Server.
- A **workspace view** is a server-owned logical grouping of projects. Desktop
  can present it as a native window; a web client presents it through browser
  navigation.
- A **project** is a user-facing workspace with a root folder, name, colour,
  icon, sidebar state, and one or more docked panels.
- A **panel** is a terminal, file, or folder surface. Panels can be split,
  reordered, and moved between projects or workspace views without losing
  their identity.
- A **terminal session** is a server-owned native PTY. Its immutable session
  id, not its title or current directory, is the boundary used by activity,
  agents, MCP, recording, and remote access.
- **Settings, macros, and secrets** are classified by their server or client
  scope. Server state is available to every authorized client; device-local
  state and credentials remain on that client.

## Product pillars

1. Fast native terminals and flexible project layouts.
2. Project navigation, file editing/previewing, folder views, and task views.
3. Git worktree awareness and reviewed AI-assisted Quick Push workflows.
4. Automation through macros, dictation, AI tab metadata, and local MCP tools.
5. Clear agent/activity state and optional local terminal recording.
6. Secure connections to embedded or standalone Terminay Servers.
7. One responsive, server-bundled workspace UI across desktop and browser
   hosts.

## Architecture boundaries

### Terminay Server

`terminay-server` owns PTYs, workspace state, persistence, filesystem and Git
operations, recordings, agents, MCP, automation, server-scoped settings and
secrets, device trust, and remote exposure.

It runs either as a Desktop-supervised Local child or as a standalone headless
process. One runtime-validated application protocol carries commands, events,
terminal streams, and bounded content over authenticated local or WebRTC
transports.

Every server bundles the complete responsive workspace UI and matching client
library for its runtime and application-protocol version. That bundle is the
only full workspace application: browser and Desktop hosts bootstrap, verify,
and run the selected server's bundle instead of supplying an independently
versioned workspace renderer.

### Client hosts

Terminay Desktop and `web.terminay.com` are protocol-blind connection hosts
around the shared server-bundled workspace UI. They own connection bootstrap,
credential protection, verified bundle installation, and host presentation;
they do not interpret or persist application-protocol workspace state.

Desktop adds native windows, embedded-server supervision, application updates,
operating-system integration, and secure credential storage. It opens on the
embedded server connection named **Local** and can open other server
connections in separate windows. Every Local or remote connection window runs
the selected server's exact verified bundle over an opaque host-provided byte
transport. A separate, capability-negotiated host bridge provides optional
native presentation without becoming a server or workspace API.

The web host has no local server. Its stable shell adds, remembers, opens, and
manages remote connections, establishes the compatible bootstrap transport,
and installs the selected server's bundle into an isolated session origin. It
does not ship a second full workspace build.

### Hosted services

Terminay's hosted service provides static bootstrap assets, the web connection
host, WebRTC signaling, and relay coordination. It is data-blind: terminal,
filesystem, workspace, recording, setting, and secret data do not become
hosted application data.

### Security boundaries

Client and renderer code is untrusted at every privileged boundary. It receives
neither Node access nor ambient Electron IPC. The server validates every
command against the authenticated device and exact server, project, panel, and
terminal identities.

Project/window and terminal-session boundaries remain security boundaries for
remote access, MCP, recordings, and agent status. User-facing titles, current
focus, and client-supplied paths do not define authority.

The governing contracts are
[server runtime and application protocol](./features/server-runtime-and-protocol.md),
[server-owned workspace state](./features/server-owned-workspace-state.md), and
[connections and client hosts](./features/connections-and-client-hosts.md).
