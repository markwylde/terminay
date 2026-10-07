# Terminay product overview

## Product

Terminay is a local-first, server-backed terminal workspace for software
projects. It combines native shell sessions with project-aware tabs, file and
Git tools, automation, AI-agent awareness, recording, and secure remote access
so development work can stay in one focused application.

A Terminay Desktop installation includes Terminay Server for local use. The
same server runs headlessly on another workstation, VPS, or dedicated machine.
A Desktop window or browser session runs one workspace UI bundle and attaches
to as many servers as the user wants: project tabs from a laptop, a build box,
and a VPS sit side by side in one tab strip.

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
- A **composition** is a window's client-owned arrangement of connections: the
  primary connection whose bundle it runs, the attached connections with the
  workspace view each shows, and the interleaved project tab order. It is
  device-local presentation state persisted by the host; servers never see it
  and never talk to each other.
- A **project** is a user-facing workspace with a root on its server's
  filesystem, a name, colour, icon, sidebar state, and an ordered list of
  folders. Nothing else decides where it executes.
- A **folder** groups a project's panels and has its own panel layout. Every
  project has a General folder, where new terminals land. Every worktree of the
  project's Git repository has a linked folder, which shows its branch, pull
  request, and checks; a terminal created there starts in that worktree, and
  the Files and Changes panes follow the selected folder. A folder carries no
  authority: moving a panel between folders changes nothing about what it may
  do.
- A **panel** is a terminal, file, or folder surface. Panels can be split,
  reordered, moved between the folders of a project, and moved freely between
  the projects of one server without losing their identity. The only boundary a
  panel cannot cross is a server, and that boundary is a connection.
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

Terminal sessions can outlive the server process. When that is enabled, shells
run in a detached session holder per data root, and a restarting server
reattaches to them and restores their tabs, layout, and output (ADR-0035). The
holder is part of the server's trust boundary: only the server reaches it, over
an owner-only socket in the data root, and clients still address terminals only
through the server.

Language intelligence is one of those server-hosted extension capabilities. A
language-server extension declares the languages and file selectors it serves;
the server runs one language session per project and language, shared by every
client, behind a bounded core-owned protocol surface. No Language Server
Protocol traffic and no editor language worker crosses the application
protocol, and the client runs no language service of its own: diagnostics,
completion, hover, and definition are computed on the server that owns the
project or are absent.

Coding-agent awareness is another. The server bundles two built-in extensions:
`terminay-builtin-agents` and `terminay-language-typescript`. The agents
extension reports every live Claude Code, Codex, Grok, and oh-my-pi session on
the server's machine through one session source, detected by the
[`@markwylde/all-your-agents`](https://github.com/markwylde/all-your-agents)
library. The server decides which project a session belongs to (its working
directory is under the project root or inside one of the repository's linked
worktrees) and which terminal owns it (its process descends from that
terminal's PTY). The same extension contributes the MCP install targets that
Desktop's Install Terminay MCP dialog offers.

It runs either as a Desktop-supervised Local child or as a standalone headless
process. One runtime-validated application protocol carries commands, events,
terminal streams, and bounded content over authenticated local or WebRTC
transports.

Every server bundles the complete responsive workspace UI and matching client
library for its runtime and application-protocol version. A window runs one
such bundle, from its **primary connection**: Desktop always runs the bundle
packaged with its embedded Local server, and a browser session runs the bundle
of the server it opened. That one bundle then talks to every **attached
connection** as well. Compatibility is a protocol contract, negotiated per
connection: the bundle declares the application-protocol range and the feature
capabilities its client requires, the server answers in its hello, and the
client classifies the connection as compatible, degraded, or incompatible. An
incompatible server stays attached with its tabs greyed and inert, naming which
side must be upgraded; it receives no operations.

### Client hosts

Terminay Desktop and `app.terminay.com` are protocol-blind connection hosts
around the shared server-bundled workspace UI. They own connection bootstrap,
credential protection, verified bundle installation, and host presentation;
they do not interpret or persist application-protocol workspace state.

Desktop adds native windows, embedded-server supervision, application updates,
operating-system integration, and secure credential storage. It opens on the
embedded server connection named **Local**, which is every window's primary
connection, and attaches remembered remote connections into the same window.
The host owns every credential and every transport and hands the bundle one
opaque byte endpoint per connection through a versioned `connections` host
capability; the bundle never holds a device key. The host also persists each
window's **composition**, the attached connections and the interleaved project
tab order, as device-local presentation state beside window geometry. A
separate, capability-negotiated host bridge provides optional native
presentation without becoming a server or workspace API.

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

MCP authority has two parts, both checked by the server on every request: the
calling terminal's capability scope (which terminals it can reach) and the
user's permission policy (which kinds of operation it may perform). The policy
groups operations into Read Terminals, Full Terminal Management, Read
Automations, Full Automation Management, App Windows, and Connected Server
Tools, with a further Window Messages policy, each set to Ask Permission, Always
Allow, or Never Allow in Settings > AI > Terminay MCP. An Ask request waits on
an inline prompt in the calling terminal's pane, answerable from any client
with authority to create terminals on that server. See
[MCP permissions](../openspec/specs/mcp-permissions/spec.md).

An agent can show the user an **app window**: a floating window in the terminal
it is running in, holding sandboxed HTML. It comes from one of two places. The
agent can write the HTML itself with the Terminay MCP tool `show_window`. Or the
user can list third-party MCP servers under Settings > AI > Connected MCP
servers; Terminay then connects to them as a client that supports MCP Apps,
offers their tools to agents as `<name>__<tool>`, and shows a tool's own UI when
the agent calls it. Either way no agent CLI is hooked or reconfigured. A window
belongs to the terminal that opened it, minimises to a tab on the pane's bottom
edge, runs only on the device that controls that terminal, and can send a
message back, which is typed into the terminal. Its content runs in an
opaque-origin frame with no access to the workspace. See
[terminal app windows](../openspec/specs/terminal-app-windows/spec.md) and the
[MCP app gateway](../openspec/specs/mcp-app-gateway/spec.md).

An agent that reuses one window design does not write it out each time.
`show_window` takes `html_file`, the absolute path of a saved HTML file, in
place of `html`, with `data`, a JSON value of up to 64 KiB that the page reads
as `window.terminay.data` before its own scripts run. The file is read by the
MCP adapter, which is the agent's own child process; Terminay Server is sent the
document and never the path, and the file's contents are not returned to the
agent.

A person can **attach files** to the message a window sends. The page passes the
files they picked to `window.terminay.sendMessage(text, { files })`, up to 16 of
any type. Terminay Server saves each one under `terminay-attachments` in its
temporary directory, under a name it chooses, and adds an `Attached: <path>`
line per file to the message it types into the terminal, so the agent can open
them; the page is never told a path. Attachments are held to everything a
window message is: the person's gesture, control of the terminal, and the Window
Messages permission, whose prompt names each file and its size. A file has no
size limit and is streamed in 256 KiB parts. When one message's files total more
than 8 MiB the window asks the person to confirm first, and an upload shows its
progress and can be cancelled. Terminay does not remove an attached file: it
stays until the operating system clears the temporary directory. Attachments and
`data` are for windows an agent wrote, not for the views of connected servers.

Every other device attached to that terminal sees a live, read-only **mirror**
of the window, as it sees the terminal itself. The controlling device records
the view's document and its changes and the server relays them; the server runs
no browser and keeps none of it. A mirror is scaled to fit the window it is shown
in and takes no input. What is not mirrored: the value of a password field
(shown masked), canvas, video, audio, and frames from another origin. A view of
any size is mirrored: a large one is streamed in parts. A device whose
connection cannot deliver the view whole says so and stops asking, and shows
the mirror again when it can. Taking control from a mirror starts the window on
the new controlling device with what was filled in carried over: text, ticked
boxes, selections, and scroll position. A password is never carried, and a view
that keeps state only in its own script rebuilds it from what it was given.

The server derives every project's root from canonical project state. Labels,
hostnames, IPs, URLs, and paths supplied by a client cannot redirect an
operation or widen its root.

The governing contracts are
[server runtime and application protocol](../openspec/specs/server-runtime-and-protocol/spec.md),
[server-owned workspace state](../openspec/specs/server-owned-workspace-state/spec.md), and
[connections and client hosts](../openspec/specs/connections-and-client-hosts/spec.md).
Extensions are governed by the
[server extension platform](../openspec/specs/extension-platform/spec.md).
