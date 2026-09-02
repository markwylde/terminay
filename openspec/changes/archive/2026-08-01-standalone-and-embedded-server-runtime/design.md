## Context

See proposal.md. The change turns Terminay Server into an independently
startable product runtime and makes Desktop a supervisor of that same runtime
rather than the owner of a parallel Electron-only implementation. It builds on
the workspace and protocol foundation and the server-owned workspace model.

## Goals / Non-Goals

Goals:
- One composition path shared by standalone and embedded modes, with identical
  lifecycle ordering and failure semantics.
- An authenticated local transport whose behaviour matches the framed transport
  for the same operation registry.
- Reproducible standalone artifacts with verifiable provenance and no Electron
  in the dependency graph.

Non-Goals:
- Daemonization as part of application correctness; foreground operation is the
  supported primitive and service-manager units are examples.
- Claiming native release coverage for every target from local runs. Native
  Linux x64/arm64 execution stays a hosted CI release gate.
- Full feature-surface parity claims between local HTTP and framed transports;
  the parity proven here is over the shared operation registry and its
  canonical result shapes.

## Decisions

- **Injected platform paths.** `ServerPlatformPaths` is validated and
  snapshotted before either standalone or embedded service factories run, with
  immutable path delivery and data-root mismatch rejection covered for both
  modes. No component calls `app.getPath(...)`.
- **Failure-safe lifecycle ordering.** Services start before the authenticated
  UI listener and the listener stops before services. A partially started
  service hook rolls back exactly once, never starts or stops the listener, and
  a repeated shutdown cannot repeat cleanup. Concurrent `start()` callers
  coalesce before any service or listener side effect.
- **One authority per data root.** An atomic mode-0600 `FileDataRootLease`
  prevents a second process from reusing a data root; stale locks are never
  silently stolen. `createLoopbackUiServer` binds `127.0.0.1:0` so the OS
  claims each listener atomically.
- **Private bootstrap credential.** `DesktopLocalServerSupervisor` mints one
  short-lived credential per start, passes it only through the one-time child
  bootstrap channel, and verifies the child readiness proof and its expiry.
  Concurrent starts coalesce; embedded stop joins an in-flight start so a
  server cannot become ready after stop returns. An expired credential is
  rejected before the shared listener is constructed.
- **Rollback on handoff failure.** If the private Desktop readiness handoff
  fails after the shared authenticated listener has started, bootstrap rolls
  back the listener, the endpoint claim, and server-owned services; listener
  teardown failure cannot prevent service cleanup.
- **Desktop lifecycle policy is explicit.** Renderer reload is non-destructive.
  `application` versus `last-window` shutdown policy is applied explicitly, and
  the server always stops on application quit.
- **Fail closed on malformed diagnostics.** A malformed standalone
  health/readiness lifecycle snapshot returns only the bounded unavailable
  result and recovers when a valid snapshot appears.
- **One registry, two transports.** Local HTTP carries the validated JSON
  envelope plus bounded raw bytes without base64 expansion, uses the same
  canonical protocol envelope and body budget as framed transports, and adds no
  smaller operation cap. Both paths return the same canonical `not_found`,
  `forbidden`, and retryable `deadline` results, propagate operation deadlines
  into handler abort signals, and preserve command idempotency per
  authenticated client.
- **Cancellation is correlation-scoped.** A local HTTP request disconnect
  aborts only the matching operation; an unrelated in-flight request, including
  a framed raw-binary command, stays live and returns its exact result. Framed
  client cancellation emits one validated cancel envelope after command
  acceptance.
- **Capabilities follow authorities.** AI, Git, recordings, macros, and
  settings are absent from minimal embedded composition and advertised only
  when their concrete authority is supplied. Standalone supplies a durable
  atomic settings repository, a durable macro repository, a data-root-backed
  recording library, and a Git authority bound asynchronously to only the
  configured canonical `default` project root before readiness. AI requires an
  explicit `--ai-providers` / `TERMINAY_AI_PROVIDERS` opt-in, passes only a
  small allowlisted provider process environment, and never accepts API keys as
  flags or protocol values.
- **Credentials are header-only.** Endpoint and token URLs are not retained in
  browser history, logs, or connection metadata, and responses set
  `Referrer-Policy: no-referrer`.
- **Deterministic artifacts.** The npm-packed standalone payload is
  byte-reproducible across two packs, contains the declared CLI, MCP, server,
  and release-integrity entries with no source or Electron payload, and runs
  its integrity check before returning `--version` from an isolated,
  symlink-free production dependency closure. Release-integrity validation
  binds verification to regular files inside the extracted artifact and rejects
  an executable manifest entry replaced by a symlink even when its target has
  the expected bytes.
- **Packaged runtime resolution is proven, not assumed.** Extracted,
  symlink-free Desktop and standalone packages resolve `node-pty` from their
  staged closure against a hostile cwd and `NODE_PATH`, run the real
  `terminay-mcp`, `--pairing`, `--status`, and foreground entries, reconcile
  `0700` managed provider hooks with no endpoint or token secrets in provider
  configs, and reject a hash-valid UI bundle whose declared server version does
  not match the embedded runtime. The Desktop embedded adapter is statically
  constrained to delegate runtime construction to `@terminay/server` and cannot
  reintroduce an Electron-only import, `LocalUiServer`, or `ServerRuntime`
  construction.

## Risks / Trade-offs

- The local HTTP boundary is a second transport surface with its own failure
  modes; the mitigation is conformance testing that dispatches the same
  registry through both paths and compares canonical results.
- Optional-authority composition means a client's capability set depends on
  host configuration. Runtime hosts must supply real configured authorities
  before optional surfaces are advertised, and clients must negotiate rather
  than assume.
- Native release evidence cannot be produced locally. Both native matrix jobs
  must still produce their verified archive and evidence pairs before a release
  claims native Linux x64/arm64 artifact execution. The available arm64 Podman
  Linux VM is useful native-instruction diagnostic coverage but is not the
  required GitHub-hosted `ubuntu-24.04-arm` release-runner record, and its x64
  container path is QEMU-emulated and explicitly non-native. The final clean
  local preflight passed 19/19 layout, CI-wiring, archive-safety,
  evidence-binding, and release-readiness assertions; see
  `openspec/adr/evidence/task6-runtime-layout.md`.
- The Compose example exposes a direct loopback protocol endpoint (`4317`
  bound `0.0.0.0` inside the container, `127.0.0.1:4317` on the host) with
  health on `8080`; this is deliberately a single-container convenience and not
  a hardened deployment topology.

## Migration Plan

Electron main was drained rather than forked: the privileged Desktop bridge
obtains its terminal authority from the Electron-free
`createServerCoreComposition` factory, and Desktop's Local supervisor injects
its one-time credential into the shared `@terminay/server` embedded bootstrap
instead of constructing a Desktop-only server or UI listener. A standalone
dependency-graph test rejects direct, dynamic, and CommonJS Electron imports so
the split cannot regress.
