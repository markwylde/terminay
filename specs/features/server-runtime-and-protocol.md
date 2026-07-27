# Terminay server runtime and application protocol

## Summary

`terminay-server` is the authoritative Terminay runtime. It owns native
terminal sessions, workspace state, privileged project services, persistence,
pairing, and connected-client authorization. The same server runtime can run:

- embedded and supervised by Terminay Desktop for the default **Local**
  connection; or
- as a standalone headless process on a workstation, VPS, dedicated machine,
  or another computer.

Every server bundles the complete responsive Terminay workspace UI built from
the same source as the desktop experience. A browser or desktop connection
therefore runs the UI version shipped with that server instead of depending on
an independently deployed latest workspace build.

## Product topology

Terminay has four distinct runtime roles:

1. **Terminay Server** owns workspace and machine authority.
2. **Terminay Desktop** owns native application windows, local-server
   supervision, OS integration, and connection credentials.
3. **The web connection host** at `web.terminay.com` owns browser-local
   connection metadata and launches or embeds an origin-isolated server UI.
4. **The hosted bootstrap/signaling service** owns only static bootstrap,
   manager-shell, WebRTC signaling, and operational relay state. It never
   becomes a terminal, filesystem, or application-data proxy.

These are deployable roles, not four independent product implementations. The
server-bundled workspace UI, client library, protocol schemas, and responsive
components are shared.

## Runtime modes

### Embedded local server

- Terminay Desktop starts one embedded server before opening the default
  workspace window.
- The server binds only to an authenticated loopback or OS-local endpoint until
  the user explicitly exposes it.
- Desktop receives readiness, endpoint, server identity, and a short-lived
  bootstrap credential through a private parent/child channel.
- Closing or reloading an individual renderer does not terminate PTYs.
- Desktop supervises unexpected server exit and presents recovery rather than
  silently starting a second authority over the same data directory.
- The embedded server uses a dedicated data directory and imports supported
  legacy Desktop state exactly once.

### Standalone server

- `terminay-server` starts without Electron, a display server, or a browser.
- The foreground command reports readiness and a clear data/log location.
- A first-run or explicit pairing command prints a short-lived secure pairing
  URL and requires the configured PIN or an equivalent explicit approval.
- The runtime handles `SIGINT`/`SIGTERM` with bounded graceful shutdown,
  finalizes recordings, closes clients, and terminates or preserves child
  processes according to the documented session-lifetime policy.
- It exposes health and version diagnostics without exposing workspace names,
  paths, terminal data, device records, or secrets.
- Standalone distributions support the documented desktop platforms and common
  Linux server architectures; unsupported native `node-pty` builds fail
  during installation/startup with actionable guidance.

## Server identity and storage

- A server has a stable random identity distinct from its mutable display name,
  network address, pairing room, or connection label.
- Reinstall/import and data-directory cloning must not accidentally advertise
  two live authorities with one identity. Identity rotation is explicit.
- Workspace state, settings, macros, trust records, reconnect grants, audit
  events, and service metadata live under one documented server data root.
- Workspace/project files and configured recording directories remain at their
  user-selected filesystem locations.
- Writes that define canonical state are transactional or atomically
  replaceable, schema-versioned, and recoverable after interruption.
- The storage implementation is hidden behind a repository boundary so the
  foundation task can select the simplest backend that meets atomicity,
  migration, and concurrent-client requirements.

## Application protocol

Terminay uses one versioned application protocol above every transport. It is
the canonical client/server contract across local and remote connections.

The protocol includes:

- a handshake containing protocol version, server version, stable server
  identity, client identity, authorization scope, and capability set;
- correlated commands and responses with runtime-validated payloads;
- revisioned workspace snapshots and ordered mutation events;
- resumable terminal output with per-session sequence positions and bounded
  snapshots;
- typed activity, agent, file-watch, settings, recording, and connection
  events;
- bounded binary transfer for files, previews, recordings, dictation audio, and
  server-bundled assets;
- cancellation, deadlines, backpressure, and explicit resource limits;
- structured errors that distinguish validation, authorization, conflict,
  unavailable, incompatible, and internal failures; and
- reconnect/resync rules that never require the client to guess whether a
  mutation committed.

Protocol types and runtime validators live in a dependency-light shared
package. UI code consumes a `TerminayClient` interface and does not call
Electron IPC, WebRTC, WebSocket, or server internals directly.

## Transports

The application protocol is transport-neutral:

- embedded Local connections use an authenticated loopback or OS-local
  transport;
- exposed remote connections use isolated WebRTC data channels;
- test transports run in memory and must pass the same conformance suite.

A transport moves framed bytes and reports lifecycle/backpressure. It does not
implement workspace behaviour. Local and WebRTC connections must therefore
produce the same authorization, commands, events, errors, and reconnect
semantics.

Remote channels may remain separated by traffic class so large asset/file
transfers cannot block terminal control:

- connection/control;
- application commands and events;
- terminal streams;
- assets and bounded binary content.

The hosted relay carries signaling only. TURN may relay encrypted WebRTC
packets, but Terminay-hosted application infrastructure does not terminate or
inspect the application protocol.

## Server-bundled workspace UI

- The server distribution contains a complete production build of the
  responsive Terminay workspace UI and a manifest binding it to the server and
  protocol versions.
- Local clients can load the bundle from the authenticated local server.
- WebRTC clients obtain and hash-verify the bundle through the existing
  origin-isolated asset-install flow.
- The hosted bootstrap refuses incomplete, oversized, path-unsafe, or
  hash-invalid bundles.
- A server UI remains usable when opened directly at its session origin.
- `web.terminay.com` is not a second independently evolving full workspace
  build. It is a stable connection host around the selected server's bundle.

## Authentication and authorization

- Local embedded bootstrap credentials are random, short-lived, scoped to the
  supervised server, and never placed in normal logs or persistent URLs.
- Remote first pairing requires the one-time URL secret plus the configured PIN
  or an explicit approval policy. The public server/session identifier is not
  sufficient authority.
- Reconnect proves possession of the origin-bound device key and reconnect
  grant before receiving a fresh connection ticket.
- Every command is authorized against the authenticated device, server,
  project, panel, terminal, or administrative scope. User-supplied titles and
  paths never define authorization.
- Full-control pairing is presented as equivalent to interactive shell access
  to the server machine. Narrower roles are outside this contract but fit
  within the same protocol envelope.
- Device revocation closes live connections, invalidates reconnect material,
  and cannot be undone merely from browser-local metadata.

## Session lifetime

- PTYs and server-side agents are owned by the server, not by a renderer,
  browser tab, Electron window, or individual transport connection.
- They continue running through client disconnect, reload, window close, and
  temporary network loss.
- A client can resubscribe using session identity and output position without
  duplicating the PTY or replaying already acknowledged output.
- An explicit terminal-close command ends the PTY for all clients.
- Terminay does not promise PTY survival across an actual server-process
  restart. Durable workspace state records the interruption and does not
  present an ended process as live.

## Security boundaries

- The server treats all client messages as untrusted, including messages from
  its own bundled UI.
- Filesystem and Git operations validate canonical paths against the intended
  server/project scope.
- Terminal output, filenames, project roots, agent state, recordings, settings,
  and secrets never pass through the hosted signaling application.
- Remote UI code loaded inside Electron has no Node integration or ambient
  preload authority.
- Secrets are rendered or applied on the server where possible; a remote client
  is not given plaintext merely to type it back into a PTY.
- Logs and diagnostics redact pairing, reconnect, device, secret, and terminal
  content.

## Failure and recovery

- A client that loses transport shows the last confirmed revision as stale,
  disables unsafe mutations, and reconnects/resynchronizes without creating a
  replacement server or terminal.
- An incompatible protocol receives a clear version/capability error. Direct
  server URLs remain the recovery path because their UI ships with the server.
- Corrupt canonical state is preserved for diagnosis and recovered from the
  last valid committed state where possible; it is never silently replaced with
  defaults.
- Failure in files, Git, AI, recording, or one PTY does not take down the
  connection runtime or unrelated sessions.

## Non-goals

- No cloud storage or proxying of workspace/application data.
- No independent latest workspace application at `web.terminay.com`.
- No requirement that Local connections use WebRTC.
- No peer-to-peer collaborative text editing.
- No promise that PTYs survive a server-process or machine restart.

## Acceptance outcomes

- The same server build runs embedded and headless without importing Electron
  in server-core.
- Local and WebRTC transport conformance tests exercise one application
  protocol.
- Closing every client leaves active PTYs running while the server remains
  alive.
- A direct session URL installs and runs the exact UI bundle shipped by the
  selected server.
- The hosted relay can be removed from the application-data path without
  affecting local operation.
- An unauthorized, stale, cross-server, cross-project, or replayed command is
  rejected at the server boundary.
