## ADDED Requirements

### Requirement: Single server runtime in two deployment modes
One server runtime SHALL start either as a standalone headless process or as a
Desktop-supervised Local child, from the same composition code. Both modes
SHALL take explicit configuration for the data root, runtime mode, log sink, UI
bundle, local endpoint, and shutdown policy, and SHALL receive validated
injected platform paths rather than reading them from Electron.

#### Scenario: Same lifecycle in both modes
- **WHEN** the shared lifecycle assertions are applied to the standalone and
  embedded runtimes
- **THEN** both start services before the authenticated UI listener, stop the
  listener before services, and do not run either stop path twice on repeated
  shutdown

#### Scenario: Data root mismatch
- **WHEN** injected platform paths disagree with the configured data root
- **THEN** the runtime rejects the configuration before any service factory runs

#### Scenario: Concurrent start callers
- **WHEN** several callers invoke `start()` concurrently
- **THEN** exactly one composition starts, every caller receives the same
  readiness, and normal shutdown ordering is retained

#### Scenario: Listener fails during startup
- **WHEN** the authenticated UI listener fails while starting
- **THEN** the runtime rolls back its server services exactly once and a
  following repeated shutdown repeats neither listener nor service teardown

### Requirement: Standalone configuration and diagnostics
The standalone runtime SHALL expose readiness, version, health, and structured
diagnostics that redact data roots, log sinks, UI bundle paths, workspace data,
and pairing material. Configuration SHALL be accepted through documented flags,
environment variables, and config with deterministic precedence and validation,
and SHALL fail closed on a malformed lifecycle snapshot.

#### Scenario: Malformed lifecycle snapshot
- **WHEN** a health or readiness lifecycle snapshot is malformed
- **THEN** the server returns only the bounded unavailable result, and recovers
  once a valid snapshot is available

#### Scenario: Flags override environment
- **WHEN** an explicit flag and an environment variable configure the same
  setting
- **THEN** the flag takes precedence and the returned diagnostics redact
  configured data roots, logs, UI bundle paths, and pairing material

#### Scenario: Signal shutdown
- **WHEN** the foreground runtime receives SIGTERM
- **THEN** it completes bounded graceful shutdown and exits cleanly

### Requirement: Embedded server supervision
Desktop SHALL supervise exactly one Local server. It SHALL mint one random
short-lived credential per start, deliver it only through the one-time private
child bootstrap channel, verify the child readiness proof and its expiry,
coalesce concurrent starts, and report stable server identity and readiness
before the workspace is opened. A crashed server SHALL be distinguishable from
a deliberate shutdown and SHALL be recoverable without running two authorities.

#### Scenario: Concurrent recovery of a crashed server
- **WHEN** several callers request recovery of a crashed Local server
- **THEN** they coalesce on one replacement and the crashed authority is
  retired first

#### Scenario: Stop joins an in-flight start
- **WHEN** stop is requested while bootstrap is still starting
- **THEN** stop joins the in-flight start, and the server cannot become ready
  after stop returns

#### Scenario: Expired bootstrap credential
- **WHEN** the private bootstrap credential has expired
- **THEN** the embedded adapter rejects it before constructing the shared
  listener

#### Scenario: Renderer reload and window close
- **WHEN** a renderer reloads, or the last window closes while the `application`
  lifecycle policy is selected
- **THEN** the server and its PTYs stay alive, and the server stops only on
  application quit

### Requirement: Embedded local server composition and isolation
Embedded bootstrap SHALL compose the same runtime and authenticated local UI
listener as standalone, claim a collision-safe loopback endpoint, and hold an
atomic mode-0600 lease on its data root so another process cannot use that data
root concurrently. A stale lease SHALL NOT be silently stolen. If the private
readiness handoff fails after the listener has started, bootstrap SHALL roll
back the listener, the endpoint claim, and server-owned services before
returning failure.

#### Scenario: Two listeners started concurrently
- **WHEN** two loopback UI listeners are started at the same time
- **THEN** each binds `127.0.0.1` with an OS-assigned port and they receive
  distinct ports

#### Scenario: Readiness handoff fails
- **WHEN** the Desktop readiness handoff fails after the listener has started
- **THEN** the listener, endpoint claim, and services are all torn down, and a
  listener teardown failure does not prevent service cleanup

### Requirement: Standalone server operation
The standalone CLI SHALL provide `start`, `status`/`version`, and
pairing/exposure entry points that work without a display, print readiness,
data and log paths, and pairing instructions without leaking secrets, and SHALL
support foreground operation as the primary mode with service-manager units
supplied only as examples.

#### Scenario: Foreground start on a clean Linux host
- **WHEN** the non-root, read-only Linux image is started with an isolated
  writable data volume
- **THEN** it reports ready on its readiness endpoint and exits with code `0`
  on SIGTERM

#### Scenario: Pairing entry
- **WHEN** the packed `--pairing` entry runs for a configured exact remote
  origin
- **THEN** it returns a short-lived fragment-only pairing bootstrap record,
  does not start the listener, and creates no server state

### Requirement: Restrictive response policy on the local UI origin
The authenticated local origin SHALL serve the exact bundled responsive
workspace manifest and assets only to authenticated requests, SHALL accept
credentials in headers rather than URLs, and SHALL set
`Referrer-Policy: no-referrer` so endpoint and token material is not retained
in browser history, logs, or connection metadata.

#### Scenario: Unauthenticated manifest request
- **WHEN** the bundle manifest is requested without the private bootstrap
  credential
- **THEN** the listener rejects the request

#### Scenario: Authenticated asset request
- **WHEN** the manifest and an asset are requested with the credential
- **THEN** the listener serves the verified manifest and the byte-exact asset

### Requirement: Transport neutrality and conformance
The authenticated local HTTP boundary and the framed transport SHALL dispatch
the same query, command, and raw-binary operation registry, use the same
canonical protocol envelope and body budget, and return matching canonical
results. The local HTTP boundary SHALL NOT introduce a smaller operation cap,
and command idempotency SHALL be retained per authenticated client.

#### Scenario: Unknown operation
- **WHEN** an unknown operation is dispatched over either transport
- **THEN** both return the same canonical `not_found` command result

#### Scenario: Write-scoped operation with read scope
- **WHEN** a write-scoped operation is invoked by a client authenticated with
  read scope
- **THEN** both transports return the same canonical `forbidden` result without
  dispatching the handler

#### Scenario: Deadline exceeded
- **WHEN** a bounded shared operation exceeds its requested deadline
- **THEN** both transports propagate the deadline into the handler's abort
  signal and return the same canonical retryable `deadline` result

#### Scenario: Raw binary body
- **WHEN** a registered operation carries a bounded raw binary body
- **THEN** both transports carry the validated JSON envelope plus the exact
  bytes without base64 expansion, and reject malformed or oversize frames

### Requirement: Connection-scoped failure containment
Cancellation SHALL be correlation-scoped. A local HTTP request disconnect or a
framed client cancel SHALL abort only the matching operation, and an unrelated
in-flight request SHALL remain live and return its exact result.

#### Scenario: Disconnect during one of two requests
- **WHEN** one local HTTP request disconnects while another is in flight
- **THEN** only the matching operation is aborted and the unrelated request
  returns its exact result

#### Scenario: Cancelled framed binary command
- **WHEN** a framed raw-binary command is cancelled
- **THEN** it receives its exact bytes before observing abort, while an
  unrelated framed command stays live

#### Scenario: Framed cancel envelope
- **WHEN** a client cancels an accepted command
- **THEN** exactly one validated cancel envelope is emitted and the server
  aborts only the matching request

### Requirement: Authentication and pairing authority
A client SHALL complete the shared protocol handshake, establishing server
identity, negotiated capabilities, bounded limits, and bootstrap authorization,
before any workspace access. Every subsequent query or command envelope SHALL
be bound to that completed handshake and its current authorization scope.

#### Scenario: Browser host handshake
- **WHEN** a browser host loads the server's authenticated local bundled UI
- **THEN** it retrieves the verified manifest and byte-exact assets and
  completes the browser-origin handshake against that same listener

#### Scenario: Request without a handshake
- **WHEN** a query or command arrives without a completed handshake
- **THEN** the server rejects it

### Requirement: Bounded extension and environment protocol operations
Optional server-owned authorities SHALL be composed into one canonical
operation registry, and a capability SHALL be advertised only when its concrete
authority is supplied. AI, Git, recordings, macros, and settings SHALL be
absent from a minimal composition.

#### Scenario: Minimal composition
- **WHEN** a runtime composes without AI, Git, recording, macro, or settings
  authorities
- **THEN** neither those capabilities nor their operations are advertised

#### Scenario: Standalone durable authorities
- **WHEN** standalone supplies a durable atomic settings repository, a durable
  macro repository, a data-root-backed recording library, and a Git authority
  bound to only the configured canonical `default` project root before readiness
- **THEN** the authenticated client negotiates those capabilities and carries
  real settings, macro, recording, and bounded Git operations, without exposing
  storage or repository paths or accepting an arbitrary working directory

#### Scenario: AI opt-in
- **WHEN** standalone is started without `--ai-providers` or
  `TERMINAY_AI_PROVIDERS`
- **THEN** no AI authority, capability, or `ai.*` operation exists; when
  enabled, only a small allowlisted provider process environment is passed and
  API keys are never accepted as flags or protocol values

### Requirement: Stale-state handling on transport loss
The local UI transport SHALL provide bounded output and event replay with
subscriptions, and a client SHALL be able to resync from a snapshot across a
transport restart without inventing continuity.

#### Scenario: Server-only restart
- **WHEN** the standalone server restarts while a web host stays open
- **THEN** the host reconnects through the authenticated local protocol, sees
  the existing default session, and resyncs from a snapshot without exposing
  pairing tokens

### Requirement: Release packaging validation
The standalone artifact SHALL be byte-reproducible across two packs, contain
the declared CLI, MCP, server, and release-integrity entries with no source or
Electron payload, and run its release-integrity check before serving any entry
point from an isolated, symlink-free production dependency closure. No Electron
import SHALL exist in the standalone server dependency graph.

#### Scenario: Repeated pack
- **WHEN** the standalone payload is packed twice
- **THEN** the two payloads are byte-identical

#### Scenario: Electron import search
- **WHEN** the compiled CLI, server, MCP, server-core, protocol, and transitive
  production module graph is resolved
- **THEN** direct, dynamic, and CommonJS Electron imports are all rejected

#### Scenario: Manifest entry replaced by a symlink
- **WHEN** an executable manifest entry is replaced by a symlink whose target
  has the expected bytes
- **THEN** release-integrity validation rejects the artifact, because
  verification is bound to regular files inside the extracted artifact

### Requirement: Deterministic artifact manifest verification
The artifact manifest SHALL declare payload hashes, pinned Node metadata,
required entrypoints, and provenance pointers. CI SHALL build the archive twice
per native target, compare archive hashes, reject source and Electron paths,
run a target-matched extraction, manifest, ELF, and bounded CLI-version probe
with build tooling removed, and record and immediately verify a
machine-readable evidence file binding the exact archive byte count and SHA-256
to the full Git commit and the native runner identity before upload.

#### Scenario: Cross-target or cross-commit evidence
- **WHEN** an evidence record names a different target, a different commit, a
  symlink, or substituted bytes
- **THEN** verification fails closed and the artifact is not uploaded

#### Scenario: Probe on a non-matching host
- **WHEN** the archive probe is run on a host whose architecture does not match
  the archive
- **THEN** it refuses to emulate the target binaries rather than reporting a
  successful execution

### Requirement: Supported runtime matrix
Packaging-sensitive runtime dependencies SHALL resolve from the runtime's own
production closure in development, packaged Desktop, and standalone layouts.
`node-pty` SHALL be resolved only from the staged, symlink-free closure even
when a hostile working directory or `NODE_PATH` offers another module. Managed
provider hook scripts SHALL be mode `0700`, accept only loopback delivery, and
provider configurations SHALL contain no endpoint or token secrets.

#### Scenario: Hostile module path
- **WHEN** a packed runtime starts with a hostile cwd and `NODE_PATH` offering
  another `node-pty`
- **THEN** it resolves `node-pty` from its own staged closure and runs a
  bounded real PTY on supported Unix platforms

#### Scenario: MCP entry without a control socket
- **WHEN** the packed `terminay-mcp` entry runs without an inherited local
  control socket
- **THEN** it completes release-integrity verification and then fails closed
  before accepting MCP work

#### Scenario: Managed hooks reconciled
- **WHEN** the packaged runtime reconciles its managed Codex and Claude hook
  configurations into an isolated HOME
- **THEN** both scripts are mode `0700`, delivery is loopback-only, and neither
  provider config embeds endpoint or token secrets

### Requirement: Bundle manifest declarations govern launch
A packaged host SHALL reject a UI bundle whose declared server version does not
match the embedded runtime, before binding its loopback listener, even when the
bundle's hashes are valid. The listener SHALL resolve its verified manifest and
nested unpacked assets from an absolute unpacked payload directory regardless
of the process working directory.

#### Scenario: Mixed-version bundle
- **WHEN** a hash-valid bundle declares a server version other than the
  embedded runtime's
- **THEN** the host refuses to start and does not bind its listener

#### Scenario: Unrelated working directory
- **WHEN** the compiled standalone listener runs with an unrelated working
  directory
- **THEN** it still resolves its verified manifest and nested unpacked UI assets
