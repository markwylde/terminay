# Standalone and embedded server runtime

## Goal

Ship one Terminay Server runtime that can start headlessly or as a
Desktop-supervised Local child, serve its matching workspace bundle, and expose
the shared application protocol over an authenticated local transport.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Electron main is currently the process authority and service container. The PTY
host is a child process, but server lifecycle, paths, settings, trust, and
renderers still depend on Electron APIs.

## Dependencies

- [Workspace and protocol foundation](../tasks_completed/4-workspace-and-protocol-foundation.md)
- [Server-owned workspace model](../tasks_completed/5-server-owned-workspace-model.md)

## Work slices

### Runtime composition

- [x] Create a server entry with explicit configuration for data root, runtime
  mode, log sink, UI bundle, local endpoint, and shutdown policy.
- [x] Replace `app.getPath(...)` dependencies with injected platform paths.
  `ServerPlatformPaths` is validated and snapshotted before standalone or
  embedded service factories run; focused tests cover immutable path delivery
  and data-root mismatch rejection for both runtime modes.
- [x] Move service construction out of Electron main into server composition.
  The privileged Desktop bridge now obtains its terminal authority from the
  Electron-free `createServerCoreComposition` factory; composition tests cover
  the injected PTY service and MessagePort boundary.
- [x] Add readiness, version, health, and structured diagnostics that redact
  workspace and secret data.
- [x] Fail closed when a standalone health/readiness lifecycle snapshot is
  malformed: return only the bounded unavailable result, then recover when a
  valid snapshot is available; covered by
  `apps/terminay-server/test/health-server.test.mjs`.
- [x] Handle signals and graceful shutdown with bounded timeouts.
- [x] Keep standalone and embedded composition startup failure-safe before the
  authenticated UI listener is attempted: a partially started service hook
  rolls back exactly once, never starts/stops the listener, and a following
  repeated runtime shutdown cannot repeat cleanup; covered by
  `apps/terminay-server/test/runtime-composition.test.mjs`.

### Embedded supervision

- [x] Start exactly one Local server from Desktop with a private bootstrap
  channel and random short-lived local credential. `DesktopLocalServerSupervisor`
  mints one per-start credential, passes it only through the one-time child
  bootstrap channel, verifies the child readiness proof and expiry, and
  coalesces concurrent starts; `apps/terminay-desktop/test/local-server.test.mjs`
  and `apps/terminay-desktop/test/desktop-bootstrap-integration.test.mjs` cover
  the production boundary.
- [x] Select a collision-safe loopback/OS-local endpoint. `createLoopbackUiServer`
  binds `127.0.0.1` with port `0`, allowing the OS to claim each listener
  atomically; `apps/terminay-server/test/runtime-composition.test.mjs` starts
  two listeners concurrently and verifies distinct loopback ports.
- [x] Prevent another process from reusing the data root concurrently with an
  atomic mode-0600 `FileDataRootLease`; stale locks are never silently stolen.
- [x] Report readiness and stable server identity before opening the workspace.
- [x] Detect crash versus deliberate shutdown and provide retry/recovery without
  starting two authorities.
- [x] Coalesce concurrent shared embedded bootstrap starts before authority
  claim, bootstrap-credential minting, or readiness publication. The same
  ready authority is returned to every caller; covered by
  `apps/terminay-server/test/bootstrap.test.mjs`.
- [x] Make embedded stop join an in-flight bootstrap start before cleanup, so a
  server cannot become ready after stop returns; concurrent stops share one
  teardown of the runtime, endpoint, and data-root lease; covered by
  `apps/terminay-server/test/bootstrap.test.mjs`.
- [x] Keep the server alive through renderer/window reload and close according
  to the selected Desktop lifecycle policy. `DesktopLocalServerSupervisor`
  treats reload as non-destructive, applies explicit `application` versus
  `last-window` shutdown policy, and always stops on application quit;
  `apps/terminay-desktop/test/local-server.test.mjs` proves both policies.

### Standalone CLI

- [x] Implement clear `start`, `status/version`, and pairing/exposure entry
  points without requiring a display.
- [x] Print readiness, data/log paths, and pairing instructions without leaking
  secrets into unrelated diagnostics.
- [x] Support configuration through documented flags/environment/config with
  deterministic precedence and validation.
- [x] Provide foreground operation first and example service-manager units
  without making daemonization part of application correctness.
- [x] Make the standalone one-container Compose example advertise a direct
  loopback protocol endpoint. It binds `4317` as `0.0.0.0` inside the
  container and `127.0.0.1:4317` on the host, emits
  `http://localhost:4317` pairing URLs, retains health on `8080`, and sets a
  writable `/var/lib/terminay` HOME for server-owned hooks. The Compose syntax
  and image contract are covered by
  `apps/terminay-server/test/docker-contract.test.mjs`.

### Local protocol and UI bundle

- [x] Serve the exact bundled responsive workspace manifest/assets from an
  authenticated local origin.
- [x] Implement the shared protocol handshake on the selected local transport.
- [x] Expose authenticated query/command envelopes for registered server-core
  operations on the local HTTP transport, binding each request to a completed
  client handshake and its current authorization scope. Local HTTP uses the
  same canonical protocol envelope/body budget as framed transports and must
  not add a smaller operation cap; command idempotency is retained per
  authenticated client.
- [x] Complete parity for every shared query/command operation, binary bodies,
  cancellation transport, and remote/local conformance on this HTTP boundary.
  - [x] Framed local and headless transports preserve representative query,
    command, bounded binary-body, and correlation-scoped cancellation behavior;
    `packages/server-core/test/remote-local-conformance.test.mjs` covers both
    transport shapes.
  - [x] Local HTTP protocol-frame requests carry the validated JSON envelope
    plus bounded raw bytes without base64 expansion; query/command integrity,
    malformed-frame, and oversize cases are covered by
    `apps/terminay-server/test/local-ui-server.test.mjs`.
  - [x] Local HTTP request disconnects abort only the matching operation and do
    not abort an unrelated in-flight request; covered by
    `apps/terminay-server/test/local-ui-cancellation.test.mjs`.
  - [x] The same local HTTP disconnect isolation holds for framed raw-binary
    commands: the cancelled command receives its exact bytes before observing
    abort, while an unrelated framed command stays live and returns its exact
    command result; covered by
    `apps/terminay-server/test/local-ui-cancellation.test.mjs`.
  - [x] Local HTTP and framed commands propagate an operation deadline into the
    matching handler's abort signal before returning the same bounded
    `deadline` result; covered by
    `apps/terminay-server/test/local-ui-framed-conformance.test.mjs`.
  - [x] Framed client cancellation emits one validated cancel envelope after
    command acceptance, and the server aborts only the matching request;
    covered by `packages/client-core/test/client.test.mjs` and
    `packages/server-core/test/cancellation-transport.test.mjs`.
  - [x] The local HTTP boundary and framed transport dispatch the same query,
    command, and raw-binary operation registry with matching results;
    `apps/terminay-server/test/local-ui-framed-conformance.test.mjs` compares
    both paths without claiming full feature-surface parity.
  - [x] Server composition accepts the existing server-owned AI, Git, and
    recording protocol authorities and merges every operation and policy into
    the same canonical registry used by embedded framed and local HTTP hosts.
    `packages/server-core/test/server-composition.test.mjs` enumerates the
    complete currently server-ready surface. Runtime hosts must supply real
    configured authorities before these optional surfaces are advertised.
  - [x] Add a server-owned settings protocol authority for revisioned
    `settings.get`, `settings.update`, and `settings.reset`, including conflict
    results, operation scopes, and `settings.changed` journal events. It is
    composed only when a concrete durable `ServerSettingsRepository` is
    supplied; covered by `packages/server-core/test/settings-protocol.test.mjs`
    and the enumerated composition surface test.
  - [x] Derive optional capability advertisement from the authorities actually
    supplied to shared composition: AI, Git, recordings, macros, and settings
    are absent from minimal embedded composition and present only with their
    configured authority. Standalone supplies a durable atomic settings
    repository under its data root and carries a real settings query/update
    through the authenticated HTTP client; covered by
    `packages/server-core/test/server-composition.test.mjs` and
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Compose a durable standalone macro repository under the server data
    root and bind macro execution to the exact server-owned PTY identity for
    bounded text, supported key, and inactivity steps. The spawned standalone
    HTTP client negotiates `macros`, performs get/upsert, and runs the saved
    macro against the default terminal; secret and clipboard steps remain
    unavailable without explicit vault/clipboard authorities. Covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Compose standalone recordings with a private data-root-backed native
    recording library and bind non-replay PTY output plus terminal exit to the
    canonical recording service. The authenticated HTTP client negotiates
    recordings and proves start, stop, list, and bounded replay without
    exposing storage paths; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Bind the standalone Git authority asynchronously to only the configured
    canonical `default` project root before readiness, advertise `git` only
    after composition, and enforce response-sized status/diff/worktree limits.
    The authenticated HTTP client proves bounded status and opaque worktree
    discovery without accepting an arbitrary cwd or exposing repository paths;
    covered by `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Keep AI capability absent unless a host supplies a complete
    server-owned `AiService` authority. A deterministic configured authority
    proves authenticated HTTP model discovery and cancellation, while a
    composition without that authority exposes neither the capability nor any
    `ai.*` operation. Production configuration must supply an exact terminal
    target/replay authority and bounded server-side provider adapters; provider
    credentials remain callback-scoped and are never CLI flags or protocol
    values. Covered by
    `apps/terminay-server/test/local-ui-framed-conformance.test.mjs`.
  - [x] Add explicit standalone `--ai-providers` /
    `TERMINAY_AI_PROVIDERS` opt-in for the existing bounded Codex and Claude
    Code CLI adapters. Disabled/default mode has no AI authority or capability;
    enabled mode passes only a small allowlisted provider process environment
    and never accepts API keys as flags. A spawned authenticated HTTP server
    uses deterministic configured model metadata to prove real
    `ai.models.list` dispatch without invoking an external provider; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] The local HTTP protocol-frame and framed transport preserve the same
    raw-binary query result and canonical protocol body budget for a registered
    query-with-body operation; covered by
    `apps/terminay-server/test/local-ui-framed-conformance.test.mjs`.
  - [x] The local HTTP boundary and framed transport return the same canonical
    `not_found` command result for an unknown operation, proving that a
    transport-specific route cannot turn a rejected command into a dispatch;
    covered by `apps/terminay-server/test/local-ui-framed-conformance.test.mjs`.
  - [x] The local HTTP boundary and framed transport return the same canonical
    `forbidden` command result for a write-scoped operation authenticated with
    read scope, without dispatching the handler; covered by
    `apps/terminay-server/test/local-ui-framed-conformance.test.mjs`.
  - [x] The local HTTP boundary and framed transport return the same canonical
    retryable `deadline` command result when a bounded shared operation exceeds
    its requested deadline; covered by
    `apps/terminay-server/test/local-ui-framed-conformance.test.mjs`.
  - [x] The spawned standalone CLI's authenticated HTTP terminal registry
    preserves lifecycle operations beyond attach/input/kill: resize records the
    requested dimensions, acknowledgement retains its exact position, detach
    retires the attachment, and resume returns a new attachment; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Compose bounded server-owned File Viewer content operations for the
    canonical standalone `default` project. The real authenticated HTTP client
    vertical slice queries `file.text-metadata` after handshake and receives
    canonical metadata only; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Compose the canonical server-owned file catalog registry for the
    standalone `default` project. The real authenticated HTTP client lists the
    project, sends a bounded raw binary body through `files.create`, and reads
    the exact bytes back through `files.content-range`; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical bounded `files.search` query through the spawned
    standalone CLI's authenticated HTTP boundary. The real client searches the
    canonical project catalog and receives its seeded README result; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical `files.rename` command through the spawned
    standalone CLI's authenticated HTTP boundary. The real client renames a
    seeded project file and reads its exact text at the destination; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical `files.create-directory` command through the
    spawned standalone CLI's authenticated HTTP boundary. The real client
    creates a project-relative directory and lists the server-owned catalog to
    verify the canonical directory entry; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical `files.delete` command through the spawned
    standalone CLI's authenticated HTTP boundary. The real client deletes a
    binary project file and lists the server-owned catalog to verify it is no
    longer exposed; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry bounded canonical `files.tasks` aggregation through the spawned
    standalone CLI's authenticated HTTP boundary. The real client receives the
    parsed completed and remaining Markdown tasks plus canonical totals from
    the server-owned project catalog; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry bounded canonical `files.content-hex` reads through the spawned
    standalone CLI's authenticated HTTP boundary. The real client creates a
    binary file, reads deterministic rows through the hex operation, and
    verifies the exact bytes and rows; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry bounded canonical `files.size` reads through the spawned
    standalone CLI's authenticated HTTP boundary. The real client sizes a
    binary project file and receives its exact byte and entry totals; covered
    by `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry bounded canonical `files.content-preview` reads through the
    spawned standalone CLI's authenticated HTTP boundary. The real client
    reads a project Markdown preview, verifies its safe classification and
    receives the exact bounded preview bytes; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry bounded canonical `files.content-capabilities` reads through the
    spawned standalone CLI's authenticated HTTP boundary. The real client
    receives the renderer-safe Markdown classification and bounded capability
    contract independently of content reads; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Compose the server-owned file editor session registry into the spawned
    standalone CLI's authenticated HTTP boundary. The real client opens a
    canonical file, sends raw draft bytes through `files.edit`, saves the
    revision, reads the persisted session text, and closes the session; covered
    by `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical server-owned `files.metadata` session query through
    the spawned standalone CLI's authenticated HTTP boundary. The real client
    opens a file then receives its exact current draft/disk metadata through
    the independent session query; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the remaining destructive file-session reconciliation operations
    through the spawned standalone CLI's authenticated HTTP boundary. A dirty
    draft rejects `files.reload` without confirmation, confirmed reload resets
    the draft, and `files.keep-local` preserves the acknowledged draft through
    its following save; the rejection is a structured JSON protocol value,
    not a transport-level 500. Covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical raw `files.read-range` session query through the
    spawned standalone CLI's authenticated HTTP boundary. The real client
    reads an exact offset and byte range from a saved server-owned draft,
    independently of the decoded `files.read-text` projection; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical server-owned `activity.snapshot` query through the
    spawned standalone CLI's authenticated HTTP boundary. The real client
    receives an initial revision/cursor-consistent snapshot from the
    independently composed activity authority; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical server-owned `activity.delta` query through the
    spawned standalone CLI's authenticated HTTP boundary. The real client
    replays from the snapshot's exact revision/cursor and receives the
    canonical empty event delta, proving the HTTP registry preserves this
    independent reconciliation operation; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [x] Carry the canonical server-owned `activity.acknowledge` command
    through the spawned standalone CLI's authenticated HTTP boundary. The real
    client waits for default-terminal PTY activity, acknowledges that exact
    terminal, and observes the authoritative attention/acknowledged state
    transition; covered by
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
- [x] Establish a client handshake with server identity, negotiated
  capabilities, bounded limits, and bootstrap authorization before workspace
  access.
- [x] Compose the standalone local HTTP endpoint with the same server-core
  terminal operation registry used by embedded/framed transports and create a
  default `default/default` PTY session for browser attach; covered by
  `apps/terminay-server/test/standalone-http-transport.test.mjs`.
- [x] Prove the local Docker Compose web host can connect through nginx to the
  standalone server's authenticated local HTTP protocol, query server health,
  see the default `default/default` PTY session, and reconnect after a
  server-only restart without exposing pairing tokens in evidence; covered by
  `scripts/docker-compose-web-server-smoke.mjs` and
  `specs/decisions/evidence/docker-compose-web-server-smoke.md`.
- [x] Add bounded output/event replay and subscriptions with snapshot resync
  across a local UI transport restart.
- [x] Ensure endpoint/token URLs are not retained in normal browser history,
  logs, or connection metadata; credentials are header-only and responses use
  `Referrer-Policy: no-referrer`.

### Packaging

- [x] Implement the reproducible standalone-artifact pipeline for the agreed
  initial platforms.
  - [x] The actual npm-packed standalone payload is byte-reproducible across
    two packs, contains the declared CLI, MCP, server, and release-integrity
    entries without source or Electron payload, and its extracted CLI runs its
    integrity check before returning `--version` from an isolated, symlink-free
    production dependency closure. The extracted foreground runtime also
    creates its default PTY session before reporting readiness; covered by
    `scripts/standalone-artifact.test.mjs`. This is package-artifact proof,
    not a claim of native release coverage for every initial platform.
  - [x] CI defines a native Linux x64/arm64 matrix that builds the standalone
    archive twice from compiled server/UI payloads and an isolated production
    dependency closure (not workspace symlinks or server source), compares the
    archive hashes, rejects source/Electron paths in the archive, and uploads
    the resulting target-specific artifact. The workflow contract is covered
    by `scripts/standalone-server-artifact-ci.test.mjs`; execution evidence on
    those native runners remains a release gate rather than a local claim.
  - [x] Before uploading either native Linux target archive, its CI matrix job
    removes compiler/build-tool availability and runs the archive's own
    target-matched extraction, manifest, ELF, and bounded CLI-version probe.
    `scripts/standalone-server-artifact-ci.test.mjs` guards that the probe is
    wired after the artifact build and before upload; the actual native run
    remains CI evidence rather than a cross-architecture local claim.
  - [x] After that native probe, CI records and immediately verifies a
    machine-readable evidence file binding the exact archive byte count and
    SHA-256 to the full Git commit and the native Linux x64/arm64 runner
    identity, then uploads the evidence beside the archive. Cross-target,
    cross-commit, symlink, and substituted-byte records fail closed; covered
    by `scripts/standalone-server-artifact-ci.test.mjs` and
    `scripts/record-native-runner-evidence.test.mjs`.
  - [x] A native-Linux-only archive probe safely inventories and extracts the
    real target archive, verifies its manifest inventory, Node and `node-pty`
    ELF architectures, then executes its own `terminay-server --version` with
    a bounded timeout. It refuses to emulate Linux binaries on another host;
    local coverage verifies its target and extraction safety contract in
    `scripts/standalone-server-archive-probe.test.mjs`.
  - [x] Standalone release-integrity validation rejects an executable manifest
    entry replaced by a symlink, even when its target has the expected bytes.
    This binds verification to regular files inside the extracted artifact,
    rather than a mutable path outside it; covered by
    `apps/terminay-server/test/release-integrity.test.mjs`.

#### Operational release follow-up (non-checkbox)

Both native matrix jobs must still produce their verified archive/evidence
pairs before a release claims native Linux x64/arm64 artifact execution. This
is hosted release evidence, not remaining project-code implementation. A local
macOS or single-architecture runner cannot truthfully prove execution of both
agreed Linux targets. The final clean local preflight passes 19/19 layout,
CI-wiring, archive-safety, evidence-binding, and release-readiness assertions.
The available arm64 Podman Linux VM is useful native-instruction diagnostic
coverage but is not the required GitHub-hosted `ubuntu-24.04-arm`
release-runner record; its x64 container path is QEMU-emulated and is explicitly
non-native. See `specs/decisions/evidence/task6-runtime-layout.md`.
- [x] Bundle the same server runtime and UI artifact inside Desktop without
  maintaining an Electron-only server fork.
  - [x] The Electron-free embedded Local bootstrap now composes the exact
    `createEmbeddedServer` runtime with the same authenticated `LocalUiServer`
    used by standalone. A real embedded launch serves a verified responsive
    bundle manifest and byte-exact asset from its selected loopback origin;
    covered by `apps/terminay-server/test/bootstrap.test.mjs`.
  - [x] Desktop's Local supervisor now claims its one-time private credential
    and injects it into the shared `@terminay/server` embedded bootstrap rather
    than constructing a Desktop-only server or UI listener. The Desktop package
    integration starts that shared runtime, fetches its authenticated manifest
    and byte-exact UI asset, and stops it through the same supervisor;
    `apps/terminay-desktop/test/embedded-runtime.test.mjs` covers the boundary.
  - [x] The embedded Local bundle listener rejects an unauthenticated manifest
    request while serving the verified manifest and byte-exact asset when the
    private bootstrap credential is supplied; covered by
    `apps/terminay-server/test/bootstrap.test.mjs`.
  - [x] If the private Desktop readiness handoff fails after the shared
    authenticated listener has started, embedded bootstrap rolls back that
    listener, the endpoint claim, and server-owned services before returning a
    failure. Listener teardown cannot prevent service cleanup; covered by
    `apps/terminay-server/test/bootstrap.test.mjs`.
  - [x] Standalone and embedded runtimes apply the same authenticated UI
    listener boundary: services start before the listener, the listener stops
    before services, and repeated shutdown does not run either stop path twice;
    covered by `apps/terminay-server/test/runtime-composition.test.mjs`.
  - [x] The shared standalone and embedded runtime rolls back its server
    services exactly once if the authenticated UI listener fails during startup;
    a following repeated shutdown cannot repeat listener or service teardown.
    Covered by `apps/terminay-server/test/runtime-composition.test.mjs`.
  - [x] Concurrent standalone and embedded `start()` callers coalesce before
    service or authenticated UI-listener side effects: one composition starts,
    every caller receives readiness, and its normal listener-before-services
    shutdown ordering is retained. Covered by
    `apps/terminay-server/test/runtime-composition.test.mjs`.
  - [x] An extracted, symlink-free Desktop npm package starts its extracted
    `@terminay/server` dependency through `createDesktopEmbeddedLocalServer`
    and serves the authenticated manifest plus byte-exact bundle asset. This
    proves the Desktop adapter imports the shared packaged server runtime rather
    than a workspace or Electron-only listener; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The same extracted, symlink-free Desktop package resolves `node-pty`
    from its staged production closure and creates a real server-core
    `TerminalService` PTY session that emits output and exits cleanly. This is
    packaged Desktop native-module execution evidence, not a claim about every
    signed release target; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package loads the shared
    server-core provider-CLI adapter and executes a bounded provider model
    discovery command from that isolated closure. This proves the packaged
    Desktop runtime does not need a workspace-only provider adapter path;
    covered by `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package deliberately stops and
    restarts the shared embedded runtime, releasing the first loopback listener
    before claiming a new endpoint and serving the same authenticated verified
    manifest and byte-exact asset. This proves packaged Desktop lifecycle
    recovery remains on the shared server bootstrap rather than retaining a
    Desktop-only listener; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package rejects an otherwise
    hash-valid shared UI bundle whose declared server version does not match
    the embedded shared runtime, before binding its loopback listener. This
    proves packaged Desktop cannot start a mixed-version UI/runtime upgrade
    surface; covered by
    `apps/terminay-desktop/test/embedded-ui-artifact-integrity.test.mjs`.
  - [x] The extracted, symlink-free Desktop package rejects an expired private
    bootstrap credential before it can construct the shared embedded listener.
    This keeps the Desktop-supervised short-lived credential boundary intact in
    the packaged adapter rather than relying on an Electron-only check; covered
    by `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The Desktop embedded adapter is statically constrained to delegate
    shared runtime construction to `@terminay/server` and cannot reintroduce
    an Electron-only import, `LocalUiServer`, or `ServerRuntime` construction;
    covered alongside the extracted-package proof by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
- [x] Verify `node-pty`, provider CLIs, hook scripts, MCP entry, and unpacked
  assets resolve in development, packaged Desktop, and standalone layouts.
  - [x] Deterministically resolve and inspect the declared development,
    standalone, and packaged Desktop entrypoint layouts; the focused contract
    checks regular files, safe paths, and the current build metadata without
    claiming native release execution (`scripts/task6-runtime-layout.test.mjs`).
  - [x] Record deterministic, non-executing resolution declarations for the
    packaging-sensitive runtime dependencies: `node-pty` is required by both
    Desktop and standalone server manifests, provider CLIs resolve from
    server-owned env/PATH (`TERMINAY_CODEX_COMMAND || codex` and
    `TERMINAY_CLAUDE_CODE_COMMAND || claude`), managed hook scripts resolve
    under `.terminay/agent-hooks` with mode `0700` and loopback-only delivery,
    the server MCP entry is `terminay-mcp`/`dist/mcpEntry.js` with inherited
    control socket/token env, and Desktop runtime assets remain declared under
    `dist-electron/**`; covered by `scripts/task6-runtime-layout.test.mjs`
    without claiming real packaged execution across all layouts.
  - [x] The extracted standalone npm package executes its real
    `terminay-mcp` entry from the isolated, symlink-free production closure:
    it completes release-integrity verification, then rejects a missing
    inherited control socket before accepting MCP work. This proves the packed
    MCP entry resolves without Electron, workspace modules, or an ambient
    control socket; covered by `scripts/standalone-artifact.test.mjs`.
  - [x] The extracted standalone npm package executes its real `--pairing`
    entry from the isolated, symlink-free production closure. It composes the
    packaged remote-exposure runtime, honours the configured exact remote
    origin, and returns a short-lived fragment-only pairing bootstrap record
    without creating an ambient workspace dependency; covered by
    `scripts/standalone-artifact.test.mjs`.
  - [x] The extracted standalone npm package executes its real `--status`
    entry from the isolated production closure after release-integrity
    verification. Flags override environment configuration while the returned
    runtime diagnostics redact configured data roots, logs, UI bundle paths,
    and pairing material; covered by
    `scripts/task6-packed-cli-status.test.mjs`.
  - [x] The extracted standalone npm package executes its foreground CLI with
    an opt-in loopback health listener from the isolated production closure.
    It reports ready only after the listener and server-owned services are
    live, serves its bounded unauthenticated `/healthz` and `/readyz` contract
    without CORS, paths, or pairing material, and exits cleanly on SIGTERM;
    covered by `scripts/task6-packed-cli-health.test.mjs`.
  - [x] The extracted, symlink-free Desktop package executes the staged shared
    server's real `terminay-mcp` entry from its production dependency closure.
    It completes release-integrity verification and rejects a missing inherited
    local control socket before accepting MCP work, proving packaged Desktop
    resolves the shared MCP entry without Electron, workspace modules, or an
    ambient control capability; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package executes the staged shared
    server's real `terminay-server --pairing` entry from its production
    dependency closure. It completes release-integrity verification, honours
    the exact configured remote origin, and emits only a short-lived
    fragment-only pairing bootstrap record. This proves packaged Desktop uses
    the shared server pairing runtime rather than a workspace or Electron-only
    remote implementation; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package executes the staged shared
    server's real `terminay-server --status` entry from its production closure.
    Explicit flags override environment configuration while returned diagnostics
    redact data roots, log sinks, and UI-bundle paths. This proves packaged
    Desktop resolves the same standalone runtime diagnostics path without
    workspace or Electron authority; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package starts the staged shared
    server's real foreground authority from its production closure, serves the
    bounded loopback readiness endpoint, and exits cleanly on SIGTERM. This
    proves the packaged Desktop payload has no hidden workspace or Electron
    dependency for the shared server lifecycle; covered by
    `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`.
  - [x] The compiled development server's real `mcpEntry.js` is covered by its
    release-integrity manifest and completes that preflight before failing
    closed when its inherited local control socket is absent. This proves the
    development MCP entry resolves through the server-owned compiled layout,
    without Electron or an ambient control capability; covered by
    `scripts/task6-development-mcp-entry.test.mjs`.
  - [x] The extracted standalone npm artifact starts with an isolated HOME and
    reconciles its real managed Codex and Claude hook configurations and
    `0700` hook scripts from the packed server-core payload, without embedding
    endpoint or token secrets in either provider config; covered by
    `scripts/standalone-artifact.test.mjs`.
  - [x] The extracted standalone npm package imports the staged shared
    server-core provider-CLI adapter from its isolated production closure and
    executes a bounded provider model-discovery child process. This proves the
    packed standalone runtime resolves provider discovery without Electron or
    workspace-only adapter paths; covered by `scripts/standalone-artifact.test.mjs`.
  - [x] The extracted, symlink-free Desktop package reconciles the shared
    server-core Codex and Claude managed hooks from its staged production
    closure into an isolated HOME. Both scripts are `0700`, provider configs
    contain no endpoint/token secrets, and the scripts accept only loopback
    delivery; covered by
    `apps/terminay-desktop/test/embedded-provider-hooks-artifact.test.mjs`.
  - [x] The compiled development server-core layout executes a bounded
    server-owned provider model-discovery child process and reconciles real
    managed Codex and Claude hook scripts into an isolated HOME. Both scripts
    are mode `0700` and neither provider config contains endpoint/token
    secrets; covered by `scripts/task6-development-runtime.test.mjs`. This is
    development-layout evidence only, not a claim of every runtime dependency
    across every release target.
  - [x] A custom composed Codex driver remains authoritative for asynchronous
    hook normalization; built-in transcript enrichment is applied only to the
    built-in Codex driver, preserving the server-owned provider contract;
    covered by `packages/server-core/test/agent-protocol.test.mjs`.
  - [x] The compiled standalone listener resolves its verified manifest and
    nested unpacked UI assets from an absolute unpacked payload directory even
    when its process working directory is unrelated; covered by
    `apps/terminay-server/test/standalone-unpacked-assets.test.mjs`.
  - [x] The packed standalone runtime resolves and executes `node-pty` only
    from its staged, symlink-free production closure even when a hostile cwd
    and `NODE_PATH` offer another module. On supported Unix platforms it runs
    a bounded real PTY and verifies its output; covered by
    `apps/terminay-server/test/packed-node-pty-layout.test.mjs`.
  - [x] The compiled development standalone CLI resolves its declared
    `node-pty` dependency rather than a hostile cwd or `NODE_PATH`, then emits
    real PTY output through its authenticated terminal protocol; covered by
    `scripts/task6-development-node-pty.test.mjs`.
  - [x] The compiled development standalone CLI executes its real `--pairing`
    path after release-integrity preflight, emits only a short-lived
    fragment-only bootstrap record for the configured remote origin, exits
    without starting the listener, and does not create server state; covered
    by `apps/terminay-server/test/standalone-pairing-handoff.test.mjs`.
- [x] Add deterministic standalone artifact version/manifest checks with
  payload hashes, pinned Node metadata, required entrypoints, provenance
  pointers, and Electron-import rejection; signing and native certification
  remain separate release gates.

## Acceptance checks

- [x] One server test suite runs against both headless and Embedded launch modes.
  `apps/terminay-server/test/runtime-composition.test.mjs` applies the same
  lifecycle assertions to `createStandaloneServer` and `createEmbeddedServer`.
- [x] Desktop can restart a crashed Local server without corrupting state or
  duplicating it. Concurrent recovery callers coalesce on one replacement and
  retire the crashed authority first; covered by
  `apps/terminay-desktop/test/local-server.test.mjs`.
- [x] Closing every renderer leaves the server and PTYs alive while the selected
  Desktop lifecycle remains active. The application lifecycle supervisor keeps
  its server-owned terminal session running through renderer reload and final
  window close, then stops it only on application quit; covered by
  `apps/terminay-desktop/test/local-server.test.mjs`.
- [x] `./terminay-server`-style foreground startup works on a clean supported
  Linux host. `apps/terminay-server/test/docker-foreground-smoke.mjs` runs the
  non-root, read-only Linux image with an isolated writable data volume, waits
  for `/readyz`, and proves that SIGTERM produces exit code `0`; it is invoked
  only with an explicitly supplied image tag so environments without a container
  runtime cannot falsely claim this coverage.
- [x] A browser host loads the server's exact authenticated local bundled UI
  and completes the shared protocol handshake. The spawned standalone CLI is
  configured with a verified two-asset bundle; the direct runtime test proves
  its manifest and byte-exact entry/script assets, then performs the
  browser-origin CORS handshake against that same listener:
  `apps/terminay-server/test/standalone-browser-ui-handshake.test.mjs`.
- [x] No Electron import exists in the standalone server dependency graph.
  `apps/terminay-server/test/standalone-dependency-graph.test.mjs` resolves the
  compiled CLI, server, MCP, server-core, protocol, and transitive production
  module graph, rejecting direct, dynamic, and CommonJS Electron imports.

## Definition of done

Terminay Server is a real independently startable product runtime, and Desktop
uses that same runtime for Local rather than hosting a second implementation in
Electron main.
