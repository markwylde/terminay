# server-runtime-and-protocol Specification

## Purpose

`terminay-server` is the authoritative Terminay runtime that owns terminal sessions, workspace state, privileged project services, persistence, pairing, and client authorization, and exposes them through one versioned application protocol carried over transport-neutral authenticated connections.

## Requirements

### Requirement: Single server runtime in two deployment modes

The same `terminay-server` runtime SHALL run either embedded and supervised by Terminay Desktop for the default **Local** connection, or as a standalone headless process on a workstation, VPS, dedicated machine, or another computer. The same build SHALL run in both modes, and server-core SHALL NOT import Electron.

#### Scenario: Embedded mode

- **WHEN** Terminay Desktop starts
- **THEN** it starts one embedded server before opening the default workspace window

#### Scenario: Headless mode

- **WHEN** `terminay-server` is started on a headless host
- **THEN** it runs without Electron, a display server, or a browser

### Requirement: Servers bundle their own workspace UI

Every server SHALL bundle the complete responsive Terminay workspace UI built from the same source as the desktop experience, together with the application-protocol client matching that server. A browser or desktop connection SHALL run the UI version shipped with the selected server rather than an independently deployed workspace build.

#### Scenario: Connecting to a server

- **WHEN** a browser or Desktop host connects to a selected server
- **THEN** it runs that server's bundled workspace UI and matching application-protocol client

#### Scenario: Direct session URL

- **WHEN** a user opens a server's session URL directly
- **THEN** the exact UI bundle shipped by that server is installed and run

### Requirement: Session entry is distinct from the connection manager

The complete server-owned session entry SHALL be a separate artifact from the `app.terminay.com` connection manager. Embedded and standalone servers SHALL publish the session entry in their signed UI-bundle manifest and SHALL NOT point that manifest at the manager entry.

#### Scenario: Opening a pairing link

- **WHEN** a user opens a pairing link
- **THEN** enrollment and the workspace open from the server's own session entry while the public manager remains a small application-protocol-blind bootstrap

### Requirement: Runtime roles

Terminay SHALL have four distinct runtime roles: Terminay Server owning workspace, trust, extension, project-environment routing, and privileged-service authority; Terminay Desktop owning native windows, local-server supervision, OS integration, connection credentials, verified bundle installation, and opaque transport delivery; the PWA connection manager owning browser-local stable-origin bookmarks and navigation; and the hosted session and signaling service owning origin-isolated session bootstrap, WebRTC signaling, and operational relay state. The hosted service SHALL never become a terminal, filesystem, or application-data proxy.

#### Scenario: Server host is one environment among others

- **WHEN** a project is executed
- **THEN** the Terminay Server host is treated as one built-in environment rather than the only execution machine

#### Scenario: Hosted service handling traffic

- **WHEN** a remote client connects through hosted signaling
- **THEN** no terminal, filesystem, or application data becomes hosted application data

### Requirement: Declared contract gates across components

Hosted bootstrap, signaling, Desktop, and web releases SHALL publish one declared set of current contracts. A component whose required contract does not validate SHALL fail before pairing, profile persistence, bundle launch, or application connection. No adapter SHALL translate between application protocol, bootstrap, transport, bundle, or host-bridge contracts.

#### Scenario: Non-matching contract

- **WHEN** a required contract version does not match at connection time
- **THEN** the attempt fails with a typed, component-specific error before connection state is committed

### Requirement: Embedded local server composition and isolation

The embedded composition boundary SHALL accept a host-injected platform path snapshot and privileged service factory, and the server runtime SHALL NOT call Electron path APIs. The embedded server SHALL use a dedicated data directory and the same canonical repositories as standalone mode, and SHALL NOT import or depend on an Electron-owned workspace store.

#### Scenario: Path resolution

- **WHEN** the embedded server resolves platform paths
- **THEN** it uses the host-injected path snapshot rather than Electron path APIs

#### Scenario: Embedded storage

- **WHEN** the embedded server persists canonical state
- **THEN** it writes to its dedicated data directory through the same canonical repositories used in standalone mode

### Requirement: Embedded server transport and bootstrap credential

The embedded server SHALL accept only Desktop's private authenticated local byte transport until the user explicitly exposes a remote route, and embedded startup SHALL NOT require or publish a network listener. Desktop SHALL receive readiness, private endpoint metadata, server identity, and a short-lived bootstrap credential through a private parent/child channel, and SHALL keep that credential in a private local-transport context only.

#### Scenario: Embedded startup

- **WHEN** the embedded server starts
- **THEN** it accepts only Desktop's private authenticated local byte transport and opens no network listener

#### Scenario: Credential handling

- **WHEN** Desktop receives the bootstrap credential
- **THEN** the credential is never copied into connection profiles, host state, logs, or normal readiness diagnostics

#### Scenario: Restart lease

- **WHEN** the embedded server restarts
- **THEN** it releases the old endpoint and data-root lease before claiming fresh readiness

### Requirement: Embedded server supervision

Closing or reloading an individual renderer SHALL NOT terminate PTYs. Desktop SHALL supervise unexpected server exit and present recovery rather than silently starting a second authority over the same data directory.

#### Scenario: Renderer reload

- **WHEN** a renderer window is closed or reloaded
- **THEN** running PTYs continue

#### Scenario: Unexpected server exit

- **WHEN** the embedded server exits unexpectedly
- **THEN** Desktop presents recovery and does not start a second authority over the same data directory

### Requirement: Standalone server operation

The standalone foreground command SHALL report readiness and a clear data and log location. A first-run or explicit pairing command SHALL print a short-lived secure pairing URL and SHALL require the configured PIN or an equivalent explicit approval. The runtime SHALL handle `SIGINT` and `SIGTERM` with bounded graceful shutdown that finalizes recordings, closes clients, and terminates or preserves child processes according to the session-lifetime policy. Unsupported native dependencies SHALL fail during startup with actionable platform and architecture guidance.

#### Scenario: Foreground start

- **WHEN** the standalone server starts in the foreground
- **THEN** it emits a bounded readiness record naming the data and log locations

#### Scenario: Pairing command

- **WHEN** the operator runs the pairing command
- **THEN** a short-lived secure pairing URL is printed and the configured PIN or explicit approval is required

#### Scenario: Termination signal

- **WHEN** the process receives `SIGINT` or `SIGTERM`
- **THEN** it performs bounded graceful shutdown, finalizing recordings and closing clients

#### Scenario: Unsupported native dependency

- **WHEN** a required native dependency is unsupported on the host
- **THEN** startup fails with actionable platform and architecture guidance

### Requirement: Standalone configuration and diagnostics

The foreground entry SHALL accept explicit `--data-root`, `--server-id`, `--endpoint`, `--log-sink`, and `--ui-bundle` values with corresponding `TERMINAY_*` environment variables as fallbacks, and command-line values SHALL take precedence over environment values. `--version` SHALL be diagnostic only. `--status` SHALL report phase, identity, version, runtime mode, and configured-resource metadata without workspace names, paths, terminal data, device records, or secrets. Health and version diagnostics SHALL similarly expose no workspace, terminal, device, or secret content.

#### Scenario: Conflicting configuration sources

- **WHEN** both a command-line value and its `TERMINAY_*` environment variable are supplied
- **THEN** the command-line value takes precedence

#### Scenario: Status output

- **WHEN** `--status` is invoked
- **THEN** the output contains only redacted phase, identity, version, runtime-mode, and configured-resource metadata

#### Scenario: Readiness output

- **WHEN** a normal foreground start emits readiness
- **THEN** the local operator output may identify configured paths, the bound protocol endpoint, and one short-lived pairing handoff for that listener

### Requirement: Supported runtime matrix

Terminay Desktop SHALL support macOS 12 Monterey or newer on Apple silicon through an arm64 DMG and 64-bit GNU/Linux on x64 through an AppImage. Terminay Server SHALL support 64-bit GNU/Linux on x64 and arm64 through self-contained archives that contain the pinned Node runtime, server code, matching responsive UI, and target-native dependencies, and SHALL require no system Node, npm, compiler, display server, or browser. Supported GNU/Linux hosts SHALL provide a Debian 12-compatible userspace with glibc 2.36 or newer. macOS x64, Linux arm64 Desktop, Windows Desktop, standalone macOS and Windows Server, and Alpine/musl Linux are outside the supported matrix.

#### Scenario: Installing the standalone archive

- **WHEN** an operator installs a standalone server archive on a supported Linux host
- **THEN** the server runs without a system Node, npm, compiler, display server, or browser

#### Scenario: Unsupported platform

- **WHEN** the runtime is used on a platform outside the supported matrix
- **THEN** it is not covered by this contract

### Requirement: Release packaging validation

Release packaging SHALL validate the standalone distribution manifest, pinned Node engine, required CLI entrypoints, payload hashes, and absence of Electron imports before publication. Native OS, architecture, and ABI probes SHALL remain release evidence, and this manifest check SHALL NOT claim signing or notarization. Native standalone release jobs SHALL establish a version-controlled checkout before building or probing the archive, and runner evidence SHALL be valid only when it binds the probed bytes to the checked-out commit and proves that worktree clean.

#### Scenario: Electron import in a server payload

- **WHEN** packaging detects an Electron import in the standalone payload
- **THEN** publication fails

#### Scenario: Release evidence

- **WHEN** a native release job records probe evidence
- **THEN** the evidence binds the probed bytes to the checked-out commit and proves the worktree clean

### Requirement: Deterministic artifact manifest verification

Standalone packaging SHALL emit a deterministic `artifact-manifest.json` containing the package version, pinned Node engine, the exact `terminay-server` and `terminay-mcp` entrypoint paths, SHA-256 payload hashes, and provenance pointers. The verification script SHALL re-hash a candidate payload and fail on missing files, changed or additional executable bins, tampering, unsafe manifest paths, or Electron imports. This SHALL be a pre-release integrity check; signatures, notarization, and native release certification remain separate gates.

#### Scenario: Tampered payload

- **WHEN** a candidate payload's re-hashed contents do not match the manifest
- **THEN** verification fails

#### Scenario: Unexpected executable bin

- **WHEN** a candidate payload adds or changes an executable bin relative to the manifest
- **THEN** verification fails

### Requirement: Release artifact build graph

Release artifact builds SHALL work from their narrow workspace entry points through the repository dependency graph, and a server-core task SHALL first materialize every public workspace package it imports, including the Extension API. Runtime staging SHALL accept the pinned npm major's exact single-result JSON shape, including npm 12's package-name map and singleton metadata arrays, and SHALL fail closed on missing, multiple, or malformed results.

#### Scenario: Malformed staging result

- **WHEN** runtime staging receives a missing, multiple, or malformed npm result
- **THEN** staging fails closed

#### Scenario: Server-core build

- **WHEN** a server-core artifact task runs
- **THEN** it first materializes every public workspace package it imports, including the Extension API

### Requirement: Terminal runtime CI and dependency normalization

CI SHALL exercise node-pty through the canonical server-core terminal authority on native x64 and arm64 runners. Desktop packaging SHALL prove its extracted `@terminay/server` dependency closure and SHALL contain no separate Electron PTY child artifact. A clean dependency install SHALL normalize the executable mode of node-pty's platform `spawn-helper`, bounded to that named helper inside the installed node-pty package, and the normalization SHALL be idempotent.

#### Scenario: Fresh dependency install

- **WHEN** a clean dependency install completes
- **THEN** the node-pty platform `spawn-helper` executable mode is normalized before development, tests, or artifact staging, and repeating the normalization changes nothing further

#### Scenario: Desktop packaging

- **WHEN** Desktop is packaged
- **THEN** it proves its extracted `@terminay/server` dependency closure and contains no separate Electron PTY child artifact

### Requirement: Build cache and task graph

Repository builds SHALL use one dependency-aware task graph in which a package build consumes the declared builds of its workspace dependencies instead of recursively rebuilding them. The development command SHALL run that full graph so workspace compiles and generated Desktop artifacts restore from cache, then stage packed built-ins and launch Electron against those files, without starting a watcher or hot-module server. Every built-in extension SHALL expose a cacheable compile task, and extension artifact staging SHALL materialize those tasks through the same graph before packing the verified release payload. Only declared reproducible build outputs SHALL be cacheable; linting, type checking, and tests SHALL execute for every CI run. Trusted CI and developer builds SHALL use the authenticated internal cache with artifact signature verification, and that cache SHALL hold disposable derived artifacts only.

#### Scenario: Running the development command

- **WHEN** the development command runs
- **THEN** workspace compiles and generated Desktop artifacts restore from cache, packed built-ins are staged, and Electron launches against those files with no watcher or hot-module server

#### Scenario: Cache miss

- **WHEN** the build cache misses
- **THEN** a complete correct build is produced, and no source, credentials, or runtime state are stored in the cache

#### Scenario: Lint and test tasks

- **WHEN** a CI run executes
- **THEN** linting, type checking, and tests run rather than restoring from cache

### Requirement: Stable server identity

A server SHALL have a stable random identity distinct from its mutable display name, network address, pairing room, or connection label. Reinstall, import, and data-directory cloning SHALL NOT accidentally advertise two live authorities with one identity, and identity rotation SHALL be explicit.

#### Scenario: Renaming a server

- **WHEN** a server's display name, address, or connection label changes
- **THEN** its stable identity is unchanged

#### Scenario: Cloned data directory

- **WHEN** a data directory is cloned or imported
- **THEN** two live authorities are not advertised under one identity without an explicit identity rotation

### Requirement: Server data root

Workspace state, settings, macros, registered device public keys, audit events, extension packages, receipts and data, project-environment profiles, and service metadata SHALL live under one documented server data root. Workspace and project files and configured recording directories SHALL remain at their user-selected filesystem locations.

#### Scenario: Locating canonical state

- **WHEN** an operator inspects a server installation
- **THEN** all canonical server-owned state is found under the documented data root

#### Scenario: User-selected locations

- **WHEN** a project root or recording directory is configured
- **THEN** its files remain at the user-selected filesystem location rather than moving into the data root

### Requirement: Settings repository and vault as server-owned services

Both runtime modes SHALL compose the revisioned settings repository and server vault as server-owned services. Runtime health and diagnostics MAY report settings revisions and vault lock and configuration metadata but SHALL never report secret values. Secret bytes SHALL be available only to a privileged server callback used by automation or provider adapters.

#### Scenario: Diagnostics including vault state

- **WHEN** runtime diagnostics report vault state
- **THEN** they include lock and configuration metadata only, never secret values

#### Scenario: Automation resolving a secret

- **WHEN** automation or a provider adapter needs a secret
- **THEN** the secret bytes are delivered only to the privileged server callback

### Requirement: Canonical state durability

Writes that define canonical state SHALL be transactional or atomically replaceable, schema-versioned, and recoverable after interruption. The storage implementation SHALL remain behind a repository boundary supporting atomic multi-object commits, revision lookup, bounded concurrent access, integrity checks, and recoverable backups.

#### Scenario: Interrupted write

- **WHEN** a canonical state write is interrupted
- **THEN** the state is recoverable and no partially applied write is presented as committed

#### Scenario: Multi-object mutation

- **WHEN** a mutation spans multiple canonical objects
- **THEN** it commits atomically

### Requirement: Versioned application protocol

Terminay SHALL use one versioned application protocol above every transport as the canonical client/server contract across local and remote connections. It SHALL include a handshake carrying protocol version, server version, stable server identity, client identity, authorization scope, and capability set; correlated commands and responses with runtime-validated payloads; revisioned workspace snapshots and ordered mutation events; resumable terminal output with per-session sequence positions and bounded snapshots; typed activity, agent, file-watch, settings, recording, and connection events; bounded binary transfer for files, previews, recordings, dictation audio, and server-bundled assets; and cancellation, deadlines, backpressure, and explicit resource limits.

#### Scenario: Opening a connection

- **WHEN** a client opens an application connection
- **THEN** the handshake carries the protocol version, server version, stable server identity, client identity, authorization scope, and capability set

#### Scenario: Invalid command payload

- **WHEN** a command payload fails runtime validation
- **THEN** the command is rejected at the server boundary

#### Scenario: Resuming terminal output

- **WHEN** a client resubscribes to a terminal session with a sequence position
- **THEN** output resumes from that position with a bounded snapshot

### Requirement: Structured protocol errors and resync rules

The protocol SHALL define structured errors distinguishing validation, authorization, conflict, provider or capability unavailable, incompatible extension, connection or trust, outcome-unknown, and internal failures. Reconnect and resync rules SHALL never require the client to guess whether a mutation committed.

#### Scenario: Authorization failure

- **WHEN** a command is rejected because the device lacks scope
- **THEN** the client receives a structured authorization error distinct from validation and conflict errors

#### Scenario: Reconnect after an in-flight mutation

- **WHEN** a client reconnects after losing transport during a mutation
- **THEN** resync determines whether that mutation committed without client guesswork

### Requirement: Protocol types and client interface boundary

Protocol types and runtime validators SHALL live in a dependency-light shared package. UI code SHALL consume a `TerminayClient` interface and SHALL NOT call Electron IPC, WebRTC, WebSocket, or server internals directly.

#### Scenario: UI performing an operation

- **WHEN** workspace UI code performs a server operation
- **THEN** it goes through the `TerminayClient` interface rather than Electron IPC, WebRTC, WebSocket, or server internals

### Requirement: Bounded extension and environment protocol operations

Fixed `extensions.*` and `project-environments.*` operations SHALL expose bounded management, status, and declarative-form DTOs. Extensions SHALL NOT register arbitrary public application operations. Every project operation SHALL derive its environment from canonical server state before dispatch.

#### Scenario: Extension attempting to expose an operation

- **WHEN** an extension attempts to register a public application operation
- **THEN** the request is refused and only the fixed bounded operations are exposed

#### Scenario: Dispatching a project operation

- **WHEN** a project operation is dispatched
- **THEN** its environment is derived from canonical server state rather than from client-supplied values

### Requirement: Extension runtime hosting

The server SHALL include the pinned npm installer needed by the extension platform while standalone support continues to require no system Node, npm, compiler, or browser. Official pinned extension tarballs SHALL be release inputs. Installed packages SHALL live under the writable server data root and SHALL NOT mutate the signed or content-addressed UI and application bundle. Each enabled extension SHALL run in a supervised server child process with bounded private IPC, and extension failure SHALL be provider-scoped and SHALL NOT prevent core or **This server** readiness. Custom extensions remain trusted server-account code; process separation SHALL NOT be described as hostile-code sandboxing.

#### Scenario: Installing an extension

- **WHEN** an extension package is installed
- **THEN** it is written under the writable server data root and the signed bundle is unchanged

#### Scenario: Extension crash

- **WHEN** an enabled extension's child process fails
- **THEN** the failure is provider-scoped and core and **This server** readiness are unaffected

### Requirement: Environment routing authority

The server-owned environment router SHALL resolve terminal, filesystem, Git, shell, agent, MCP, and lifecycle capabilities by canonical project identity. Renderer input, host bridges, paths, and labels SHALL NOT select an adapter. Missing or failed capabilities SHALL NOT fall back to the server machine.

#### Scenario: Client-supplied environment hint

- **WHEN** a client supplies an environment id, hostname, or path in a request
- **THEN** the router ignores it and resolves the adapter from canonical project identity

#### Scenario: Failed provider capability

- **WHEN** a project's environment capability is missing or fails
- **THEN** the operation fails rather than executing on the Terminay Server machine

### Requirement: Host supplies transport and presentation bridge only

The host SHALL supply two independent boundaries: an opaque framed byte transport connected to the authenticated server, and a versioned capability-negotiated presentation bridge for optional native host actions. The host SHALL forward valid bounded frames without decoding feature operations, workspace DTOs, or application events. Authentication material, reconnect grants, private keys, signaling credentials, and transport handles SHALL remain in the host's privileged connection runtime, and the workspace renderer SHALL receive only the scoped byte endpoint and sanitized connection identity needed to construct its bundled `TerminayClient`.

#### Scenario: Forwarding application traffic

- **WHEN** application frames pass through the host
- **THEN** the host forwards them without decoding feature operations, workspace DTOs, or application events

#### Scenario: Renderer construction

- **WHEN** the workspace renderer is launched
- **THEN** it receives only the scoped byte endpoint and sanitized connection identity, not credentials, keys, or raw transport handles

### Requirement: Presentation bridge capability declaration

The presentation bridge SHALL declare a bounded bridge version, host kind, and individual capabilities such as native secondary windows, native menus, approved file selection, clipboard write, notifications, updates, and guarded OS integration. Capability selection SHALL be injected by the trusted host after binding the exact window or source and server profile, and SHALL never be selected by a URL parameter, renderer setting, server response, or generic Electron IPC. An optional host capability SHALL be presented only when the host declares it, and the workspace SHALL supply its normal in-page action where that action is part of the browser product.

#### Scenario: Selecting capabilities

- **WHEN** the host constructs a presentation bridge
- **THEN** capabilities are injected after binding the exact window or source and server profile

#### Scenario: URL parameter claiming a capability

- **WHEN** a URL parameter, renderer setting, or server response claims a host capability
- **THEN** the claim does not grant that capability

#### Scenario: Capability absent

- **WHEN** an optional native capability is not declared by the host
- **THEN** the workspace supplies its normal in-page action instead

### Requirement: Independent host contract validation

The host SHALL independently validate pairing and reconnect and signaling bootstrap; the framed byte-transport ABI and resource limits; the signed content-addressed bundle manifest and asset transfer protocol; the host bridge version and required versus optional capabilities; and the declared required execution and runtime capabilities for the selected host. A missing required bridge, bundle format, transport or bootstrap version, or declared capability SHALL fail before the workspace is launched or connection state is committed.

#### Scenario: Missing required capability

- **WHEN** a required declared capability is unavailable in the selected host
- **THEN** launch fails before the workspace starts and before connection state is committed

#### Scenario: Direct-browser bootstrap failure

- **WHEN** direct-browser bootstrap fails a contract check
- **THEN** the failure renders as typed, visible, non-secret UI rather than a blank document or a top-level uncaught error

### Requirement: Browser gating by declared contracts, not user agent

For browser hosts, the manifest's protocol and schema revisions and declared required capabilities SHALL determine whether launch is valid. Browser brand, user-agent strings, and numeric browser or Chromium version ranges SHALL NOT gate bootstrap or bundle execution.

#### Scenario: Unrecognized browser

- **WHEN** a browser whose brand or version is unrecognized meets the declared required capabilities
- **THEN** bootstrap and bundle execution proceed

### Requirement: Client facades never manufacture server state

Feature-owned client facades inside the server bundle MAY reduce the shared query and command envelope to typed feature results. A host bridge SHALL NOT satisfy an application query or command facade and SHALL NOT manufacture server feature state.

#### Scenario: Host bridge asked for feature state

- **WHEN** application code requires a feature query result
- **THEN** it is satisfied by the server over the application protocol, never by the host bridge

### Requirement: Desktop byte endpoint binds server identity

The Desktop byte endpoint SHALL wrap each framed byte message in a stable versioned packet bound to the exact server identity before it reaches `TerminayClient`. The privileged host SHALL fix that identity when constructing the endpoint. Inbound packets for another server or with an invalid bounded shape SHALL be rejected while feature-level frame contents remain opaque to the host. The renderer SHALL receive no raw native transport or credential authority, and the canonical renderer SHALL accept only that selected-server byte endpoint.

#### Scenario: Packet for another server

- **WHEN** an inbound packet names a server identity other than the endpoint's fixed identity
- **THEN** it is rejected

#### Scenario: Malformed packet

- **WHEN** an inbound packet has an invalid bounded shape
- **THEN** it is rejected without the host inspecting feature-level frame contents

### Requirement: Transport neutrality and conformance

The application protocol SHALL be transport-neutral. Embedded Local connections SHALL use a private authenticated host transport, exposed remote connections SHALL use isolated WebRTC data channels, and test transports SHALL run in memory and pass the same conformance suite. A transport SHALL move framed bytes and report lifecycle and backpressure, and SHALL NOT implement workspace behaviour. Local and WebRTC connections SHALL produce the same authorization, commands, events, errors, and reconnect semantics.

#### Scenario: Local versus remote behaviour

- **WHEN** the same command is issued over a Local transport and over a WebRTC transport
- **THEN** authorization, results, events, errors, and reconnect semantics are identical

#### Scenario: Conformance suite

- **WHEN** the transport conformance suite runs
- **THEN** the in-memory, Local, and WebRTC transports exercise one application protocol

### Requirement: Ordered outbound pump and fail-closed admission

Within each ordered traffic lane, one connection-owned outbound pump SHALL serialize accepted frames, observe transport backpressure, and preserve application order across command results, subscription replay, and live events. Feature listeners SHALL NOT launch an unobserved transport send. Once the underlying transport stops accepting frames, the connection SHALL atomically stop admission, reject or cancel queued sends with one typed reason, clean up subscriptions, and close. A send rejection SHALL be a connection failure and SHALL NOT become an unhandled process rejection or leave a logically open connection on a closed socket.

#### Scenario: Backpressure

- **WHEN** the transport applies backpressure within a lane
- **THEN** the outbound pump observes it and preserves application order across command results, subscription replay, and live events

#### Scenario: Transport stops accepting frames

- **WHEN** the underlying transport stops accepting frames
- **THEN** admission stops atomically, queued sends are rejected or cancelled with one typed reason, subscriptions are cleaned up, and the connection closes

### Requirement: Transport adapter lifecycle fidelity

Transport adapters SHALL keep their reported lifecycle synchronized with the underlying channel or socket. A closing, closed, or failed underlying stream SHALL NOT be reported as writable, and concurrent close and send activity SHALL have one deterministic outcome. Reconnect SHALL establish a new connection and resume only from confirmed workspace revisions and terminal positions, and SHALL NOT reuse a half-closed transport.

#### Scenario: Closed underlying stream

- **WHEN** the underlying channel is closing, closed, or failed
- **THEN** the adapter does not report the transport as writable

#### Scenario: Reconnect

- **WHEN** a client reconnects
- **THEN** a new connection is established and resumption uses only confirmed workspace revisions and terminal positions

### Requirement: Separated terminal presentation lanes

Raw terminal presentation bytes SHALL use independently bounded attachment lanes rather than the generic reliable application-event FIFO. The connection writer SHALL reserve bounded capacity for control and workspace traffic and schedule terminal lanes fairly. Terminal-lane congestion SHALL perform attachment-scoped resynchronization and SHALL NOT be treated as a transport failure or close the shared connection. Remote channels MAY remain separated by traffic class covering connection and control, application commands and events, terminal streams, and assets and bounded binary content, so large asset or file transfers cannot block terminal control.

#### Scenario: Terminal lane congestion

- **WHEN** a terminal attachment lane becomes congested
- **THEN** that attachment resynchronizes and the shared connection stays open

#### Scenario: Large asset transfer

- **WHEN** a large asset or file transfer is in progress
- **THEN** terminal control traffic continues to be scheduled

### Requirement: Relay carries signaling only, with transcript authentication

The hosted relay SHALL carry signaling only. TURN MAY relay encrypted WebRTC packets, but Terminay-hosted application infrastructure SHALL NOT terminate or inspect the application protocol. The host SHALL sign a canonical transport transcript binding the exact offer and DTLS fingerprints to the server identity, session origin, scope, fresh client nonce, generation, and expiry. First pairing SHALL authenticate that transcript with fragment-derived key material and pin the host public key; reconnect SHALL verify it with the pinned key. Remote clients SHALL complete this check before accepting the bundle, releasing device credentials, or opening the application stream.

#### Scenario: First pairing

- **WHEN** a remote client pairs for the first time
- **THEN** it authenticates the signed transport transcript with fragment-derived key material and pins the host public key before accepting the bundle, releasing device credentials, or opening the application stream

#### Scenario: Signaling interference

- **WHEN** signaling denies or disrupts a connection
- **THEN** it cannot substitute a WebRTC endpoint or become an application-data intermediary

### Requirement: Server UI bundle distribution

The server distribution SHALL contain a complete production build of the responsive workspace UI, and for authenticated WebRTC installation SHALL expose one reusable `tar.gz` archive binding that bundle to the server and protocol versions. Direct HTTPS SHALL continue to serve ordinary static browser resources. The WebRTC archive SHALL contain schema-versioned root metadata giving each bundle a deterministic id and relative entry path, and SHALL NOT expose a per-file inventory or require per-file content hashes.

#### Scenario: Installing over WebRTC

- **WHEN** a remote client installs the bundle over WebRTC
- **THEN** it receives the archive whose root metadata gives the bundle a deterministic id and relative entry path

#### Scenario: Direct HTTPS access

- **WHEN** a browser loads the server's session origin over HTTPS
- **THEN** ordinary static browser resources are served

### Requirement: Bundle manifest declarations govern launch

The WebRTC archive metadata SHALL declare its application protocol, bundle format, supported host-bridge range, and required and optional host capabilities. The host SHALL validate those declarations and protocol and schema revisions and SHALL NOT use browser brand, user agent, or numeric browser or Chromium runtime-version ranges. Optional native capabilities SHALL NOT become requirements merely because the bundle runs inside Desktop.

#### Scenario: Bundle running in Desktop

- **WHEN** a bundle declaring optional native capabilities runs inside Desktop
- **THEN** those optional capabilities remain optional

#### Scenario: Host-bridge range mismatch

- **WHEN** the host bridge version falls outside the archive's supported range
- **THEN** launch fails before the workspace starts

### Requirement: Bundle snapshot integrity and transfer

The privileged server SHALL prepare the WebRTC archive as a bounded immutable snapshot and transfer it as acknowledged binary DataChannel chunks that stay within the negotiated SCTP maximum message size. Transfer failures SHALL send a typed JSON `asset:bundle-error` and SHALL NOT take down the host process. Archive creation SHALL reject traversal, links, duplicate normalized paths, malformed metadata, and oversized bundles. The immutable snapshot SHALL prevent source-file replacement from changing UI code during or after transfer. The hosted bootstrap SHALL refuse incomplete, oversized, path-unsafe, or hash-invalid bundles, and WebRTC clients SHALL obtain and hash-verify the bundle through the origin-isolated asset-install flow.

#### Scenario: Transfer failure

- **WHEN** a bundle transfer fails
- **THEN** a typed JSON `asset:bundle-error` is sent and the host process stays alive

#### Scenario: Unsafe archive content

- **WHEN** archive creation encounters traversal, links, duplicate normalized paths, malformed metadata, or an oversized bundle
- **THEN** creation is rejected

#### Scenario: Hash-invalid bundle

- **WHEN** the hosted bootstrap receives an incomplete, oversized, path-unsafe, or hash-invalid bundle
- **THEN** it refuses the bundle

#### Scenario: Source files change mid-transfer

- **WHEN** server source files are replaced during or after a bundle transfer
- **THEN** the transferred UI code is unchanged because the snapshot is immutable

### Requirement: Restrictive response policy on the local UI origin

The authenticated local UI origin SHALL apply a restrictive response policy to bundle, handshake, and event responses: same-origin scripts and connections with WSS for remote transport, no objects or framing, no referrer, and no camera, microphone, geolocation, payment, USB, serial, or Bluetooth permissions.

#### Scenario: Serving the bundle

- **WHEN** the local UI origin serves bundle, handshake, or event responses
- **THEN** the response policy restricts scripts and connections to same origin, forbids objects and framing, sends no referrer, and grants no camera, microphone, geolocation, payment, USB, serial, or Bluetooth permission

### Requirement: Bundle acquisition per connection kind

Local Desktop SHALL obtain the bundle from its pinned embedded-server artifact and launch it through the same verification and host-context contract used for remote bundles, without requiring a network listener. A Desktop remote connection SHALL download and commit the selected server's bundle before opening its sandboxed connection window, and Desktop SHALL NOT run its embedded server's UI against a different remote server version. `app.terminay.com` SHALL be the connection manager only: it stores stable-origin bookmarks and frames them and SHALL NOT execute a server's workspace bundle as manager-origin script. A server UI SHALL remain usable when opened directly at its session origin.

#### Scenario: Opening a remote connection from Desktop

- **WHEN** Desktop opens a remote server connection
- **THEN** it downloads and commits that server's bundle before opening the sandboxed connection window

#### Scenario: Manager framing a server

- **WHEN** `app.terminay.com` opens a bookmarked server
- **THEN** it frames the stable session origin and does not execute the server's bundle as manager-origin script

#### Scenario: Local Desktop launch

- **WHEN** Desktop launches the Local connection
- **THEN** the bundle comes from the pinned embedded-server artifact and is verified through the same contract used for remote bundles, with no network listener opened

### Requirement: Application traffic uses the framed connection protocol

Local and remote workspace application traffic SHALL use the canonical framed `ServerConnection` protocol. Local Desktop SHALL provide a private MessagePort byte transport, and remote Desktop and browser hosts SHALL provide an authenticated WebRTC byte transport. HTTP SHALL remain limited to bootstrap, health, pairing, and static asset delivery where required, and application queries, commands, and events SHALL use `ServerConnection`.

#### Scenario: Issuing an application command

- **WHEN** the workspace issues an application query, command, or event
- **THEN** it travels over `ServerConnection` rather than HTTP

### Requirement: Authentication and pairing authority

Local embedded bootstrap credentials SHALL be random, short-lived, scoped to the supervised server, and never placed in normal logs or persistent URLs. Remote first pairing SHALL require the one-time URL secret plus the configured PIN or an explicit approval policy, and the public server or session identifier SHALL NOT be sufficient authority. Reconnect SHALL prove possession of the registered origin-bound device key before receiving a fresh connection ticket.

#### Scenario: Pairing with only a public identifier

- **WHEN** a client presents only the public server or session identifier
- **THEN** pairing is refused

#### Scenario: Reconnecting

- **WHEN** a registered device reconnects
- **THEN** it proves possession of its origin-bound device key before receiving a fresh connection ticket

### Requirement: Command authorization scope

Every command SHALL be authorized against the authenticated device, server, project, panel, terminal, or administrative scope. User-supplied titles and paths SHALL never define authorization. An unauthorized, stale, cross-server, cross-project, or replayed command SHALL be rejected at the server boundary.

#### Scenario: Cross-project command

- **WHEN** a device issues a command targeting a project outside its authorized scope
- **THEN** the server rejects it at the boundary

#### Scenario: Replayed command

- **WHEN** a stale or replayed command arrives
- **THEN** it is rejected

### Requirement: Pairing roles and device revocation

Full-control pairing SHALL be presented as equivalent to interactive shell access to the server machine. Device revocation SHALL close live connections, invalidate reconnect material, and SHALL NOT be undoable merely from browser-local metadata.

#### Scenario: Presenting a pairing request

- **WHEN** a user is asked to approve full-control pairing
- **THEN** it is presented as equivalent to interactive shell access to the server machine

#### Scenario: Revoking a device

- **WHEN** a device is revoked
- **THEN** its live connections close, its reconnect material is invalidated, and browser-local metadata cannot restore access

### Requirement: Server-owned session lifetime

PTYs and server-side agents SHALL be owned by the server, not by a renderer, browser tab, Electron window, or individual transport connection, and SHALL continue running through client disconnect, reload, window close, and temporary network loss. A client SHALL be able to resubscribe using session identity and output position without duplicating the PTY or replaying already acknowledged output. An explicit terminal-close command SHALL end the PTY for all clients. PTY survival across an actual server-process restart SHALL NOT be promised; durable workspace state SHALL record the interruption and SHALL NOT present an ended process as live.

#### Scenario: All clients disconnect

- **WHEN** every client closes
- **THEN** active PTYs keep running and the server stays alive

#### Scenario: Resubscribing

- **WHEN** a client resubscribes with a session identity and output position
- **THEN** the PTY is not duplicated and already acknowledged output is not replayed

#### Scenario: Explicit close

- **WHEN** a client issues an explicit terminal-close command
- **THEN** the PTY ends for all clients

#### Scenario: Server restart

- **WHEN** the server process restarts
- **THEN** durable workspace state records the interruption and does not present an ended process as live

### Requirement: Window-independent PTY adapter

The privileged server host SHALL load its concrete PTY implementation through a window-independent adapter. The adapter SHALL accept only shell, cwd, env, and dimensions and SHALL expose output and exit callbacks to the server terminal authority. Client or window ids SHALL NOT be part of PTY creation.

#### Scenario: Creating a PTY

- **WHEN** the terminal authority creates a PTY
- **THEN** the adapter receives only shell, cwd, env, and dimensions, and no client or window id

### Requirement: Untrusted client input and path validation

The server SHALL treat all client messages as untrusted, including messages from its own bundled UI. Filesystem and Git operations SHALL validate canonical paths against the intended server and project scope.

#### Scenario: Message from the bundled UI

- **WHEN** a message arrives from the server's own bundled UI
- **THEN** it is validated as untrusted input

#### Scenario: Path outside project scope

- **WHEN** a filesystem or Git operation names a canonical path outside the intended server and project scope
- **THEN** the operation is rejected

### Requirement: Data confinement and redaction

Terminal output, filenames, project roots, agent state, recordings, settings, and secrets SHALL never pass through the hosted signaling application. Remote UI code loaded inside Electron SHALL have no Node integration or ambient preload authority. Secrets SHALL be rendered or applied on the server where possible, and a remote client SHALL NOT be given plaintext merely to type it back into a PTY. Logs and diagnostics SHALL redact pairing, reconnect, device, secret, and terminal content.

#### Scenario: Local operation

- **WHEN** a Local connection is used
- **THEN** no application data passes through the hosted relay

#### Scenario: Remote UI in Electron

- **WHEN** remote UI code runs inside an Electron window
- **THEN** it has no Node integration and no ambient preload authority

#### Scenario: Writing a diagnostic

- **WHEN** a log or diagnostic record is written
- **THEN** pairing, reconnect, device, secret, and terminal content are redacted

### Requirement: Local credential transmission restrictions

Local UI credentials SHALL be accepted only through an authorization header. Query parameters named `token`, `access_token`, `bootstrap_credential`, or `credential` SHALL be rejected, and local responses SHALL set `Referrer-Policy: no-referrer` so endpoint URLs cannot propagate credentials through browser history or referrers.

#### Scenario: Credential in a query parameter

- **WHEN** a request supplies a credential through a `token`, `access_token`, `bootstrap_credential`, or `credential` query parameter
- **THEN** the request is rejected

#### Scenario: Local response headers

- **WHEN** the local origin returns a response
- **THEN** it sets `Referrer-Policy: no-referrer`

### Requirement: Stale-state handling on transport loss

A client that loses transport SHALL show the last confirmed revision as stale, disable unsafe mutations, and reconnect and resynchronize without creating a replacement server or terminal. Loss of an outbound event stream SHALL be treated as loss of the connection even if inbound bytes were recently accepted, so a client never remains apparently connected with silently frozen workspace or terminal subscriptions.

#### Scenario: Transport loss in the client

- **WHEN** a client loses its transport
- **THEN** it marks the last confirmed revision stale, disables unsafe mutations, and reconnects without creating a replacement server or terminal

#### Scenario: Outbound stream dies

- **WHEN** the outbound event stream is lost while inbound bytes were recently accepted
- **THEN** the connection is treated as lost rather than left apparently connected

### Requirement: Connection-scoped failure containment

A transport that disconnects while the server is publishing an event SHALL be closed and unsubscribed as one failed client connection. Its rejected send SHALL be contained by the connection lifecycle, SHALL NOT become an unhandled host rejection, and SHALL NOT terminate the server process, Desktop, another client, or the underlying PTY. Transport send failure SHALL close only the affected connection and produce bounded metadata-only diagnostics. Failure in files, Git, AI, recording, or one PTY SHALL NOT take down the connection runtime or unrelated sessions.

#### Scenario: Client disconnects mid-publish

- **WHEN** a client's transport disconnects while the server publishes an event
- **THEN** only that connection is closed and unsubscribed, and the server process, Desktop, other clients, and the PTY are unaffected

#### Scenario: Feature failure

- **WHEN** a files, Git, AI, recording, or single PTY operation fails
- **THEN** the connection runtime and unrelated sessions continue

### Requirement: Contract and bootstrap failure reporting

An invalid protocol or capability contract SHALL receive a clear error before the application connection opens. Bootstrap failure SHALL identify the failing session-origin contract without exposing endpoint credentials, pairing fragments, or renderer state.

#### Scenario: Invalid capability contract

- **WHEN** a capability contract fails validation
- **THEN** a clear error is returned before the application connection opens

#### Scenario: Bootstrap failure message

- **WHEN** bootstrap fails
- **THEN** the message identifies the failing session-origin contract and exposes no endpoint credentials, pairing fragments, or renderer state

### Requirement: Corrupt state preservation

Corrupt canonical state SHALL be preserved for diagnosis and recovered from the last valid committed state where possible, and SHALL never be silently replaced with defaults.

#### Scenario: Corrupt canonical state on load

- **WHEN** canonical state is found corrupt
- **THEN** it is preserved for diagnosis and recovery uses the last valid committed state rather than silently reverting to defaults

### Requirement: Operational documentation boundary

The supported operator paths, service-manager examples, pairing and revocation boundaries, backup and restore procedure, and incident-redaction rules SHALL be documented in the standalone server operations runbook.

#### Scenario: Operator needs a procedure

- **WHEN** an operator needs backup, restore, service-manager, or incident-redaction guidance
- **THEN** the standalone server operations runbook provides it

### Requirement: Non-goals

Terminay SHALL NOT provide cloud storage or proxying of workspace and application data, an independent latest workspace application at `app.terminay.com`, a requirement that Local connections use WebRTC, peer-to-peer collaborative text editing, or a promise that PTYs survive a server-process or machine restart.

#### Scenario: Local connection transport choice

- **WHEN** a Local connection is established
- **THEN** WebRTC is not required

#### Scenario: Workspace data storage

- **WHEN** workspace or application data is persisted
- **THEN** it is stored by the selected server and not in cloud storage or proxied through hosted infrastructure
