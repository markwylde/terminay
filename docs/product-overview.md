# Terminay product overview

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

- A **server** is one workspace, trust, persistence, and extension authority.
  It has its own data root and executes every project it owns on its own
  machine. Reaching another machine means running a Terminay Server on it and
  connecting to it.
- A **server connection** is an authenticated relationship between a client
  device and one local or remote Terminay Server.
- A **workspace view** is a server-owned logical grouping of projects. Desktop
  can present it as a native window; a web client presents it through browser
  navigation.
- A **project** is a user-facing workspace with a root on its server's
  filesystem, a name, colour, icon, sidebar state, and one or more docked
  panels. Nothing else decides where it executes.
- A **panel** is a terminal, file, or folder surface. Panels can be split,
  reordered, and moved freely between the projects of one server without losing
  their identity. The only boundary a panel cannot cross is a server, and that
  boundary is a connection.
- A **terminal session** is server-owned and backed by the server's native
  terminal runtime. Its immutable session id, not its title or current
  directory, is the boundary used by activity, agents, MCP, recording, and
  remote access.
- **Settings, macros, and secrets** are classified by their server or client
  scope. Server state is available to every authorized client; device-local
  state and credentials remain on that client.

## Product pillars

1. Fast native terminals on the owning server and flexible project layouts.
2. Project navigation, file editing/previewing, folder views, and task views,
   with diagnostics, completion, hover, and definition supplied by the owning
   server. The client runs no language service.
3. Git worktree awareness and reviewed AI-assisted Quick Push workflows.
4. Automation through macros, dictation, AI tab metadata, and local MCP tools.
5. Clear agent/activity state and optional local terminal recording.
6. Secure connections to embedded or standalone Terminay Servers.
7. One responsive, server-bundled workspace UI across desktop and browser
   hosts.
8. Server-installed extensions for coding-agent awareness and language
   intelligence.

## Architecture boundaries

### Terminay Server

`terminay-server` owns terminal-session lifecycle, workspace state,
persistence, extensions, filesystem and Git authorization, recordings,
agents, MCP, automation, server-scoped settings and secrets, device trust, and
remote exposure. Privileged project work executes against the server's own host
through the canonical project resolver; nothing at the dispatch boundary
chooses a machine.

Language intelligence is one of those server-hosted extension capabilities. A
language-server extension declares the languages and file selectors it serves;
the server runs one language session per project and language, shared by every
client, behind a bounded core-owned protocol surface. No Language Server
Protocol traffic and no editor language worker crosses the application
protocol, and the client runs no language service of its own: diagnostics,
completion, hover, and definition are computed on the server that owns the
project or are absent.

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

Terminay Desktop and `app.terminay.com` are protocol-blind connection hosts
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

The web host has no local server. `app.terminay.com` adds, remembers, opens, and
manages bookmarks to remote servers. **Open** keeps the manager as the
top-level document and loads the selected stable session origin in a fullscreen
iframe so an installed iOS Home Screen app stays chrome-less. The session
origin owns device authentication, WebRTC, and installation of that
server's workspace bundle. When framed, the manager also stores that origin's
non-extractable device credential and proxies clipboard, microphone, and
notifications over origin-checked `postMessage`. The PWA does not ship a
workspace build.

Desktop and browser hosts hold no server credentials other than the connection
credentials for the servers they are paired with.

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

The server derives every project's root from canonical project state. Labels,
hostnames, IPs, URLs, and paths supplied by a client cannot redirect an
operation or widen its root.

The governing contracts are
[server runtime and application protocol](../openspec/specs/server-runtime-and-protocol/spec.md),
[server-owned workspace state](../openspec/specs/server-owned-workspace-state/spec.md), and
[connections and client hosts](../openspec/specs/connections-and-client-hosts/spec.md).
Extensions are governed by the
[server extension platform](../openspec/specs/extension-platform/spec.md).
