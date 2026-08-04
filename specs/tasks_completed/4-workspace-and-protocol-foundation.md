# Workspace and protocol foundation

## Goal

Create the independently buildable application/package boundaries and the
versioned, runtime-validated client/server protocol used by every later slice,
without changing user-facing behaviour.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

## Why this is active

The repository is one Electron/Vite package, renderer APIs are Electron
preload calls, and the remote protocol is terminal-specific. Server extraction
needs enforceable dependency direction and one transport-neutral contract
before service ownership can move safely.

## Dependencies

- [Server architecture decision spikes](../tasks_completed/3-server-architecture-decision-spikes.md)

Task 4 starts after Task 3 closes. In particular, Task 3 still determines the
concrete server WebRTC dependency and the supported native platform matrix.
Those choices do not change the package direction or transport-neutral
contract below, but no WebRTC implementation dependency or final platform
claim is added speculatively.

## Implementation map

### Applications

```text
apps/
  terminay-desktop/
    src/
      main/
      preload/
      renderer/
      compatibility/
      legacy-services/
  terminay-server/
    src/
  terminay-web/
    src/
```

- `terminay-desktop` owns Electron lifecycle, native windows, menus, updater,
  OS integration, local credential storage, embedded-server supervision, and
  compatibility code needed while application services move.
- `terminay-server` owns only the standalone/embedded server composition
  entry. The complete runtime is filled in by the server-runtime and service
  extraction tasks; creating the application boundary does not claim those
  later behaviours.
- `terminay-web` is the thin browser connection host. It is not another copy of
  the full workspace application.
- The existing terminal-only remote renderer remains an explicitly named
  compatibility build until shared-UI parity allows its removal. It is not
  promoted into the canonical protocol or responsive UI.

Each application has its own package manifest, TypeScript/build configuration,
output directory, and build command. A root orchestration command may build
them together, but no application reaches into another application's source or
output directory.

### Shared packages

```text
packages/
  protocol/
  client-core/
  responsive-ui/
  server-core/
  protocol-conformance/
```

- `@terminay/protocol` contains version negotiation, closed runtime schemas,
  deterministic framing/encoding, limits, shared ids, envelopes, structured
  errors, and the byte-transport interface.
- `@terminay/client-core` contains `TerminayClient`, connection state, command
  correlation, subscriptions, caches/resync helpers, and host-capability
  interfaces.
- `@terminay/responsive-ui` contains the one browser-safe workspace UI
  foundation and its client/host providers. Moving complete feature surfaces
  into it remains incremental work through the later service and shared-UI
  tasks.
- `@terminay/server-core` contains application-protocol connection handling,
  dispatch boundaries, and server-owned domain/service composition points. It
  has no Electron dependency.
- `@terminay/protocol-conformance` is a private development-only package. It
  owns the in-memory transport pair, scripted fault/slow-consumer transports,
  reusable protocol/transport conformance suites, and compatibility fixtures.
  It is not shipped by Desktop, Server, the server UI, or the web host.

Every package exposes an explicit `exports` map. Applications and packages
import public entries only; source-path and generated-output deep imports are
rejected.

### Dependency direction

```text
@terminay/protocol
  ├── @terminay/client-core
  │     └── @terminay/responsive-ui
  └── @terminay/server-core

@terminay/protocol-conformance
  └── development-only consumer of protocol, client-core, and server-core
```

- Desktop renderer and web/server-bundled UI code depend on responsive UI,
  client-core, and protocol only.
- Desktop main/preload code may depend on Electron, host contracts, protocol,
  and its compatibility adapters. It does not import server-core application
  services.
- Server composition depends on server-core and protocol. Concrete local and
  WebRTC transports are application adapters rather than protocol
  dependencies.
- A concrete WebRTC package belongs to the future server WebRTC adapter after
  Task 3 selects it. It never becomes a protocol, client-core, or responsive-UI
  dependency.

### Legacy-service quarantine

The current Electron-owned application services move mechanically into
`terminay-desktop/src/legacy-services/` only when needed to preserve the
working Desktop build. This directory is migration debt, not a new Desktop
architecture:

- services are moved, never copied into both Desktop and server-core;
- one compatibility-composition entry is the only new Desktop host import
  allowed to reach the quarantined services;
- new application services cannot be added to the quarantine;
- boundary tests record and reject growth of its file/import surface; and
- Tasks 5–15 remove services from the quarantine as their server-owned
  replacements become authoritative.

The existing broad preload stays available only to the existing trusted local
renderer during migration. It is not exposed to server-provided UI and is not
used as the implementation of `TerminayClient`.

### Deterministic application framing

The application protocol uses bounded binary frames rather than arbitrary JSON
strings. A frame consists of:

1. a fixed magic value and wire-format version;
2. a frame-kind discriminator;
3. fixed-width, big-endian header/body lengths;
4. a canonical UTF-8 JSON header validated against a closed schema; and
5. an optional raw-byte body for stream or binary-transfer chunks.

Shared code uses `Uint8Array`, not Node `Buffer`. Canonical JSON rejects
undefined values, non-finite numbers, duplicate/unknown fields, invalid UTF-8,
and non-deterministic key ordering. Decoders validate declared lengths and
resource limits before allocating or parsing bodies. Peers negotiate limits
downward rather than silently exceeding either side's maximum.

The envelope set covers:

- client hello, server hello, capabilities, and incompatible-version failure;
- correlated query/result and idempotent command/result;
- ordered revision/event delivery;
- stream open, chunk, acknowledgement, and close;
- binary-transfer start, chunk, acknowledgement, completion, and failure;
- cancellation and deadlines; and
- structured validation, authorization, forbidden, not-found, conflict,
  cancelled, deadline, resource, unavailable, incompatible, and internal
  errors.

Commands carry a stable command id, correlation id, validated operation and
payload, optional expected revision, and bounded deadline. A repeated completed
command id returns its recorded result rather than executing again. A
disconnect with an uncertain command outcome is resolved through command
status and snapshot/event resync; the client does not guess whether the
mutation committed.

Workspace events use ordered revisions/cursors. Terminal and binary streams use
independent monotonic positions and acknowledgements so reconnect resumes from
confirmed positions without duplicating content.

Transport-specific authentication happens before or alongside the protocol
adapter. The server handshake reports the resulting canonical client identity,
authorization scope, server identity, and capabilities; a client cannot grant
itself authority in its hello.

### Framed transport semantics

The shared transport interface exposes:

- explicit opening, open, closing, closed, and failed lifecycle states;
- an async inbound `Uint8Array` frame sequence;
- bounded queued/buffered byte counts;
- `send`, `waitForWritable`, and bounded close operations;
- cancellation through `AbortSignal`; and
- typed close reasons without application behaviour.

`send(frame)` resolves when the adapter accepts the frame into its bounded
queue. It does not mean that the peer received, acknowledged, or committed the
message. Application acknowledgements, stream positions, and command results
provide those guarantees. This rule avoids treating a concrete WebRTC
library's Boolean send return as a safe retry/delivery signal.

The in-memory implementation lives in protocol-conformance. The Electron IPC
compatibility adapter lives under the Desktop application and moves framed
bytes over one bounded bridge/port. It does not add another IPC method for
every application feature. The same conformance harness runs against both.

### Compatibility versions

Protocol version 1 is the first canonical application protocol. The current
unversioned terminal-only remote messages remain a legacy dialect and do not
become version 1.

The fixture set includes a documented version-0 handshake/envelope set and its
deterministic compatibility outcome. If version 0 is intentionally
unsupported, negotiation returns a closed `incompatible_version` error with
the supported minimum/maximum before closing; it does not partially parse or
silently downgrade the connection.

### Boundary checker

A TypeScript-AST checker inspects static imports, exports, dynamic imports, and
`require` calls, then validates both source direction and each package's
declared dependencies. It rejects:

- imports across application source trees;
- undeclared dependencies hidden by workspace hoisting;
- package-internal or generated-output deep imports;
- Electron imports from server-core;
- Node, Electron, WebRTC, WebSocket, or concrete local-transport imports from
  protocol, client-core, or responsive UI;
- UI/client/application imports from server-core;
- Desktop renderer imports from Desktop main or preload;
- Desktop host imports that bypass the one legacy compatibility composition
  entry; and
- growth of the legacy-service quarantine.

Tests include representative forbidden fixtures so a checker that accidentally
stops inspecting a syntax form fails CI. Tool/configuration files have explicit
rules rather than broad directory exemptions.

The normal smoke path runs boundary validation, package type checking,
deterministic shared-package builds, and all three independent application
builds before packaging or E2E tests.

## Behaviour-preserving move sequence

1. Complete and checkpoint Task 3 and all active feature-drift work before
   moving current source paths.
2. Add root workspace orchestration, shared compiler settings, empty
   application/package manifests, boundary tooling, and compatibility aliases
   for existing root build/test commands.
3. Implement protocol and protocol-conformance without changing the running
   application. Freeze their public framing/transport surface after malformed,
   duplicate, stale, cancelled, oversized, slow-consumer, reconnect, and
   incompatible cases pass in memory.
4. Implement client-core, server-core protocol dispatch boundaries, and the
   responsive-UI provider/host-capability foundation against those public
   protocol entries.
5. Implement the unused framed Electron IPC compatibility adapter and pass the
   conformance suite through a real main/preload/renderer path.
6. Move Desktop main, preload, renderer, assets, Vite configuration, and
   Electron Builder configuration mechanically into `terminay-desktop`.
   Preserve all current entry routes, legacy remote behaviour, package
   contents, output resolution, and E2E behaviour.
7. Add independently buildable Server and Web application compositions
   without claiming runtime or connection-host work assigned to Tasks 6 and
   18.
8. Replace hard-coded `src`, `electron`, `dist`, and `dist-electron` test/build
   paths with one workspace-path helper and application-owned output paths.
9. Enable package/import boundary checks in normal CI, build shared artifacts
   twice and compare sorted hashes, and remove temporary exceptions no longer
   required.
10. Run the complete existing smoke, focused, E2E, packaging, audit, and
    independent-application build gates before checking any Task 4 work slice.

## Parallel ownership and conflict sequencing

After Task 3 closes and the workspace skeleton/public package names are fixed,
the following slices can run in parallel with disjoint ownership:

1. **Workspace/tooling:** root manifests, shared TypeScript configuration,
   workspace scripts, boundary checker, and CI.
2. **Protocol:** `packages/protocol` only.
3. **Protocol conformance:** `packages/protocol-conformance` only.
4. **Client core:** `packages/client-core` only.
5. **Server core:** `packages/server-core` only.
6. **Responsive UI foundation:** `packages/responsive-ui` only.
7. **Electron compatibility transport:** its isolated Desktop compatibility
   directory and conformance fixture only.

Protocol defines its initial public interfaces before client-core, server-core,
and transport implementations integrate them. Follow-up API changes are
coordinated through the protocol owner rather than edited concurrently.

One application-migration owner performs all physical moves and import/path
rewrites after the package slices stabilize. No other agent moves or broadly
edits `src/`, `electron/`, root build configuration, package lockfiles, or E2E
fixture paths during that phase. A separate verification owner then audits
dependency graphs, forbidden fixtures, independent builds, output manifests,
and existing behaviour without making parallel structural changes.

## Work slices

### Workspace shape

- [x] Convert the repository into one workspace with independently buildable
  `terminay-desktop`, `terminay-server`, and `terminay-web` applications.
- [x] Add shared protocol, client-core, responsive UI, and server-core
  packages with explicit public entry points.
- [x] Keep all shared source in this workspace while the three applications
  remain independently packageable and deployable.
- [x] Preserve existing Desktop builds, packaging, and tests during the move.

### Dependency boundaries

- [x] Prevent server-core from importing Electron.
- [x] Prevent protocol, client-core, and responsive UI from importing Node,
  Electron, WebRTC, WebSocket, or a concrete local transport.
- [x] Prevent Desktop host code from becoming a second copy of application
  services.
- [x] Add boundary checks to normal CI.

### Protocol

- [x] Define handshake, capability, command, response, event, stream,
  binary-transfer, cancellation, and structured-error envelopes.
- [x] Add runtime validators, deterministic encoding, version negotiation, and
  resource limits.
- [x] Define expected revisions, idempotent command ids, deadlines,
  backpressure, and reconnect/resync semantics.
- [x] Keep Electron window ids, browser ids, titles, and transport-specific
  authorization out of the contract.

### Client and transports

- [x] Define the `TerminayClient` queries, commands, subscriptions, connection
  state, and error surface.
- [x] Define the framed transport lifecycle and backpressure interface.
- [x] Implement in-memory and compatibility Electron-IPC adapters.
- [x] Add a conformance harness reusable by Local and WebRTC transports.

### Tooling and versions

- [x] Define supported Node, Electron, browser, and platform versions.
- [x] Produce deterministic protocol/client artifacts for server and UI builds.
- [x] Add compatibility fixtures for one prior protocol version and explicit
  incompatible-version errors.

## Acceptance checks

- Existing Desktop smoke and focused feature tests remain green.
- Package-boundary tests reject representative forbidden imports.
- One protocol conformance suite passes over in-memory and framed compatibility
  transports.
- Duplicate, stale, malformed, cancelled, oversized, slow-consumer, and
  incompatible cases have deterministic test outcomes.
- Each application builds independently from the workspace.

## Definition of done

The workspace has enforceable deployable/shared boundaries and one tested
application protocol. Later tasks can move one service at a time without
creating another renderer API or transport-specific product contract.
