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

The bundle contains the application-protocol client that matches its server.
Desktop and browser hosts establish authentication and an opaque byte
transport, verify and launch the bundle, and then stay outside application
protocol interpretation. This lets one host connect across server application
versions while keeping its smaller bootstrap, transport, bundle-format,
execution-runtime, and native-host-bridge compatibility boundaries explicit.

## Product topology

Terminay has four distinct runtime roles:

1. **Terminay Server** owns workspace, trust, extension, project-environment
   routing, and privileged-service authority. Its own host is one built-in
   environment, not the only execution machine.
2. **Terminay Desktop** owns native application windows, local-server
   supervision, OS integration, connection credentials, verified bundle
   installation, and opaque local/remote transport delivery.
3. **The web connection host** at `app.terminay.com` owns browser-local
   connection metadata and launches or embeds an origin-isolated server UI.
4. **The hosted bootstrap/signaling service** owns only static bootstrap,
   manager-shell, WebRTC signaling, and operational relay state. It never
   becomes a terminal, filesystem, or application-data proxy.

Hosted bootstrap and signaling revisions publish a compatibility window for
dependent client versions. A new hosted revision must continue to accept every
currently deployed dependent client while its replacement Desktop/web clients
roll out; hosted publication and compatibility verification precede dependent
client publication, and the previous hosted revision is retired only after
those clients are covered by the new window.

These are deployable roles, not four independent product implementations. The
server-bundled workspace UI and its matching application client are one
artifact. The browser and Desktop shells share connection/bootstrap contracts
and host-capability schemas without becoming independent workspace clients.
The exact ownership and compatibility split is recorded in
[server-bundled clients and protocol-blind hosts](../decisions/server-bundled-client-hosts.md).

## Runtime modes

### Embedded local server

- Terminay Desktop starts one embedded server before opening the default
  workspace window.
- The embedded composition boundary accepts a host-injected platform path
  snapshot and privileged service factory; the server runtime never calls
  Electron path APIs.
- The server accepts only Desktop's private authenticated local byte transport
  until the user explicitly exposes a remote route. Embedded startup does not
  require or publish a network listener.
- Desktop receives readiness, private endpoint metadata, server identity, and a short-lived
  bootstrap credential through a private parent/child channel.
- Desktop keeps that credential in a private local-transport context only; it is
  never copied into connection profiles, host state, logs, or normal readiness
  diagnostics. A restart releases the old endpoint/data-root lease before
  claiming fresh readiness.
- Closing or reloading an individual renderer does not terminate PTYs.
- Desktop supervises unexpected server exit and presents recovery rather than
  silently starting a second authority over the same data directory.
- An explicitly enabled direct network listener claims its configured socket
  atomically and remains separate from the private Local transport.
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
- Unsupported native dependencies fail during startup with actionable
  platform and architecture guidance.

The foreground entry accepts explicit `--data-root`, `--server-id`,
`--endpoint`, `--log-sink`, and `--ui-bundle` values, with corresponding
`TERMINAY_*` environment variables as fallbacks. `--version` is diagnostic
only; `--status` reports phase, identity, version, and configured-resource
metadata without workspace, path, terminal, or secret contents. A normal
foreground start emits a bounded readiness record and handles `SIGINT` and
`SIGTERM` through the same graceful runtime shutdown path.

## Supported runtime matrix

- Terminay Desktop supports macOS 12 Monterey or newer on Apple silicon
  through an arm64 DMG and 64-bit GNU/Linux on x64 through an AppImage.
- Terminay Server supports 64-bit GNU/Linux on x64 and arm64 through
  self-contained archives. Each archive contains the pinned Node runtime,
  server code, matching responsive UI, and target-native dependencies. It
  requires no system Node, npm, compiler, display server, or browser.
- Supported GNU/Linux hosts provide a Debian 12-compatible userspace with
  glibc 2.36 or newer.
- macOS x64, Linux arm64 Desktop, Windows Desktop, standalone macOS and
  Windows Server, and Alpine/musl Linux are outside the supported matrix.
- Release packaging validates the standalone distribution manifest, pinned Node
  engine, required CLI/MCP entrypoints, payload hashes, and absence of Electron
  imports before publication. Native OS/architecture/ABI probes remain release
  evidence; this manifest check does not claim signing or notarization.
- CI exercises node-pty through the canonical server-core terminal authority on
  native x64 and arm64 runners. Desktop packaging proves its extracted
  `@terminay/server` dependency closure; the removed Electron `ptyHost` child
  artifact is not a v2 release input.
- A clean dependency install normalizes the executable mode of node-pty's
  platform `spawn-helper` before development, tests, or artifact staging. The
  normalization is bounded to that named helper inside the installed node-pty
  package and is idempotent.

## Server identity and storage

- A server has a stable random identity distinct from its mutable display name,
  network address, pairing room, or connection label.
- Reinstall/import and data-directory cloning must not accidentally advertise
  two live authorities with one identity. Identity rotation is explicit.
- Workspace state, settings, macros, trust records, reconnect grants, audit
  events, extension packages/receipts/data, project-environment profiles, and
  service metadata live under one documented server data root.
- The embedded and standalone runtimes compose the revisioned settings
  repository and server vault as server-owned services. Runtime health and
  diagnostics may report settings revisions and vault lock/configuration
  metadata, but never secret values. Secret bytes are available only to a
  privileged server callback used by automation or provider adapters.
- Both runtime modes compose the same extension manager, environment registry,
  vault broker, and provider router. Extensions run on the selected server and
  never depend on Electron or browser capabilities.
- Workspace/project files and configured recording directories remain at their
  user-selected filesystem locations.
- Writes that define canonical state are transactional or atomically
  replaceable, schema-versioned, and recoverable after interruption.
- The storage implementation remains behind a repository boundary. Canonical
  state supports atomic multi-object commits, numbered migrations, revision
  lookup, bounded concurrent access, integrity checks, and recoverable
  backups.

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
  provider/capability unavailable, incompatible extension, connection/trust,
  outcome-unknown, and internal failures; and
- reconnect/resync rules that never require the client to guess whether a
  mutation committed.

Cross-surface compatibility gates use bounded semantic versions for Desktop,
Server, the bundled UI, bootstrap, and signaling. A missing, below-minimum, or
above-maximum version fails before migration or connection state is committed
with a typed component-specific incompatibility error.

Protocol types and runtime validators live in a dependency-light shared
package. UI code consumes a `TerminayClient` interface and does not call
Electron IPC, WebRTC, WebSocket, or server internals directly.

Fixed `extensions.*` and `project-environments.*` operations expose bounded
management/status/declarative-form DTOs. Extensions cannot register arbitrary
public application operations. Every project operation derives its environment
from canonical server state before dispatch.

## Extension and environment runtime

The server includes the pinned npm installer needed by the canonical
[extension platform](./extension-platform.md); standalone support continues to
require no system Node, npm, compiler, or browser. Official pinned extension
tarballs are release inputs. Installed packages live under the writable server
data root and never mutate the signed/content-addressed UI/application bundle.

Each enabled extension runs in a supervised server child process with bounded
private IPC. Extension failure is provider-scoped and cannot prevent core/This
server readiness. Arbitrary custom extensions remain trusted server-account
code; process separation is not described as hostile-code sandboxing.

The server-owned environment router resolves terminal, filesystem, Git, shell,
agent, MCP, and lifecycle capabilities by canonical project identity. Renderer
input, host bridges, paths, and labels cannot select an adapter. Missing or
failed capabilities never fall back to the server machine.

## Client and host compatibility boundaries

Every selected server supplies its matching workspace bundle and
application-protocol client. The host supplies two independent boundaries:

- an opaque framed byte transport connected to the authenticated server; and
- a versioned, capability-negotiated presentation bridge for optional native
  host actions.

The host forwards valid bounded frames without decoding feature operations,
workspace DTOs, or application events. Authentication material, reconnect
grants, private keys, signaling credentials, and transport handles remain in
the host's privileged connection runtime; the workspace renderer receives only
the scoped byte endpoint and sanitized connection identity needed to construct
its bundled `TerminayClient`.

The presentation bridge declares a bounded bridge version, host kind, and
individual capabilities such as native secondary windows, native menus,
approved file selection, clipboard write, notifications, updates, and guarded
OS integration. Capability selection is injected by the trusted host after
binding the exact window/source and server profile. It is never selected by a
URL parameter, renderer setting, server response, or generic Electron IPC.

Application feature evolution does not require a matching Desktop release.
Compatibility is gated independently for:

- pairing/reconnect and signaling bootstrap;
- the framed byte-transport ABI and resource limits;
- the signed/content-addressed bundle manifest and asset transfer protocol;
- the host bridge version and required versus optional capabilities; and
- the host execution runtime, including minimum supported Chromium features.

An unsupported optional host capability falls back to the browser-equivalent
in-page behavior or a clear disabled action. An incompatible required bridge,
bundle format, transport/bootstrap version, or execution runtime fails before
the bundle is launched or connection state is committed and identifies the
component that must be upgraded.

Feature-owned client facades inside the server bundle may reduce the shared
query/command envelope to typed feature results. A host bridge never satisfies
an application query/command facade and never manufactures server feature
state.

The Desktop byte endpoint wraps each framed byte message in a stable versioned
packet bound to the exact server identity before it reaches `TerminayClient`.
The privileged host fixes that identity when constructing the endpoint;
inbound packets for another server or with an invalid bounded shape are
rejected, while feature-level frame contents remain opaque to the host. The
renderer receives no raw native transport or credential authority.

## Transports

The application protocol is transport-neutral:

- embedded Local connections use a private authenticated host transport;
- exposed remote connections use isolated WebRTC data channels;
- test transports run in memory and must pass the same conformance suite.

A transport moves framed bytes and reports lifecycle/backpressure. It does not
implement workspace behaviour. Local and WebRTC connections must therefore
produce the same authorization, commands, events, errors, and reconnect
semantics.

Within each ordered traffic lane, one connection-owned outbound pump serializes
accepted frames, observes transport backpressure, and preserves application
order across command results, subscription replay, and live events. Feature
listeners never launch an unobserved transport send. Once the underlying
transport stops accepting frames, the connection atomically stops admission,
rejects or cancels queued sends with one typed reason, cleans up subscriptions,
and closes. A send rejection is a connection failure; it never becomes an
unhandled process rejection or leaves a logically open connection on a closed
socket.

Transport adapters keep their reported lifecycle synchronized with the
underlying channel or socket. A closing, closed, or failed underlying stream is
not reported as writable, and concurrent close/send activity has one
deterministic outcome. Reconnect establishes a new connection and resumes only
from confirmed workspace revisions and terminal positions; it does not reuse a
half-closed transport.

Raw terminal presentation bytes use independently bounded attachment lanes
rather than the generic reliable application-event FIFO. The connection writer
reserves bounded capacity for control and workspace traffic and schedules
terminal lanes fairly. Terminal-lane congestion performs attachment-scoped
resynchronization under the
[terminal stream congestion and recovery](./terminal-stream-congestion-and-recovery.md)
contract; it is not a transport failure and cannot close the shared connection.

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
- The manifest is schema-versioned and gives each bundle a deterministic id,
  exact entry path, content type, byte length, and SHA-256 content hash. Asset
  paths remain inside the bundle's `/remote-app/<bundle-id>/` namespace.
- The manifest declares its application protocol, bundle format, minimum
  execution runtime, supported host-bridge range, and required/optional host
  capabilities. Optional native capabilities never become requirements merely
  because the bundle is running inside Desktop.
- The privileged server validates the manifest before serving or transferring
  it: traversal, duplicate paths, namespace escapes, malformed versions,
  oversized bundles, and hash/byte-length mismatches are rejected. Verified
  assets are read through a bounded immutable snapshot so a file replacement
  cannot change UI code after verification.
- The authenticated local UI origin applies a restrictive response policy to
  bundle, handshake, and event responses: same-origin scripts and connections
  (with WSS for remote transport), no objects or framing, no referrer, and no
  camera, microphone, geolocation, payment, USB, serial, or Bluetooth
  permissions.
- Local Desktop obtains the bundle from its pinned embedded-server artifact and
  launches it through the same verification and host-context contract used for
  remote bundles; this does not require opening a network listener.
- Local and remote workspace application traffic uses the canonical framed
  `ServerConnection` protocol. Local Desktop provides a private MessagePort
  byte transport; remote Desktop and browser hosts provide an authenticated
  WebRTC byte transport. HTTP remains limited to bootstrap, health, pairing,
  reconnect, and static asset delivery where required and is not an alternate
  query/command/event application protocol.
- WebRTC clients obtain and hash-verify the bundle through the existing
  origin-isolated asset-install flow.
- The hosted bootstrap refuses incomplete, oversized, path-unsafe, or
  hash-invalid bundles.
- A server UI remains usable when opened directly at its session origin.
- `app.terminay.com` is not a second independently evolving full workspace
  build. It is a stable connection host around the selected server's bundle.
- A Desktop remote connection downloads and commits the selected server's
  bundle before opening its sandboxed connection window. Desktop does not run
  its embedded server's UI against a different remote server version.

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
- The privileged server host loads its concrete PTY implementation through a
  window-independent adapter. The adapter accepts only shell, cwd, env, and
  dimensions, and exposes output/exit callbacks to the server terminal
  authority; client or window ids are not part of PTY creation.
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
- A transport that disconnects while the server is publishing an event is
  closed and unsubscribed as one failed client connection. Its rejected send
  is contained by the connection lifecycle, never becomes an unhandled host
  rejection, and does not terminate the server process, Desktop, another
  client, or the underlying PTY.
- Loss of an outbound event stream is treated as loss of the connection even if
  inbound bytes were recently accepted. The client never remains apparently
  connected with silently frozen workspace or terminal subscriptions.
- An incompatible protocol receives a clear version/capability error. Direct
  server URLs remain the recovery path because their UI ships with the server.
- Host failure recovery exposes metadata for a direct server-bundled client:
  the exact verified session origin and root entry path, `requiresHostShell:
  false`, and server authority. Recovery metadata never carries endpoint
  credentials, pairing fragments, or renderer state.
- Corrupt canonical state is preserved for diagnosis and recovered from the
  last valid committed state where possible; it is never silently replaced with
  defaults.
- Failure in files, Git, AI, recording, or one PTY does not take down the
  connection runtime or unrelated sessions.
- Transport send failure closes only the affected connection, produces bounded
  metadata-only diagnostics, and cannot terminate the server process or another
  client's connection.

## Operational contract

The standalone foreground command accepts explicit data-root, server-id,
endpoint, log-sink, and matching-UI-bundle values, with `TERMINAY_*`
environment variables as fallbacks. Command-line values take precedence over
environment values. `--status` returns only redacted phase, identity, version,
runtime-mode, and configured-resource metadata; readiness output is local
operator output and may identify the configured paths, bound protocol endpoint,
and one short-lived pairing handoff for that listener. `SIGINT` and `SIGTERM`
use the bounded graceful shutdown path.

The supported operator paths, service-manager examples, pairing/revocation
boundaries, backup/restore procedure, and incident-redaction rules are kept in
the [standalone server operations runbook](../operations/standalone-server.md).

Local UI credentials are accepted only through an authorization header. Query
parameters named `token`, `access_token`, `bootstrap_credential`, or
`credential` are rejected, and local responses set `Referrer-Policy:
no-referrer` so endpoint URLs cannot propagate credentials through browser
history or referrers.

Standalone packaging emits a deterministic `artifact-manifest.json` containing
the package version, pinned Node engine, required entrypoint paths, SHA-256
payload hashes, and provenance pointers. `scripts/standalone-artifact.mjs`
re-hashes a candidate payload and fails on missing files, tampering, unsafe
manifest paths, or Electron imports. This is a pre-release integrity check;
signatures, notarization, and native release certification remain separate
gates.

Native standalone release jobs establish a version-controlled checkout before
building or probing the archive. Runner evidence is valid only when it binds
the probed bytes to the checked-out commit and proves that worktree clean.

## Non-goals

- No cloud storage or proxying of workspace/application data.
- No independent latest workspace application at `app.terminay.com`.
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
