## 1. Runtime composition

- [x] 1.1 Create a server entry with explicit configuration for data root, runtime mode, log sink, UI bundle, local endpoint, and shutdown policy
- [x] 1.2 Replace `app.getPath(...)` dependencies with injected `ServerPlatformPaths`, validated and snapshotted before service factories run, verified by immutable-path-delivery and data-root-mismatch tests for both runtime modes
- [x] 1.3 Move service construction out of Electron main into server composition so the privileged Desktop bridge takes its terminal authority from `createServerCoreComposition`, verified by composition tests over the injected PTY service and MessagePort boundary
- [x] 1.4 Add readiness, version, health, and structured diagnostics that redact workspace and secret data
- [x] 1.5 Fail closed on a malformed standalone health/readiness lifecycle snapshot and recover on a valid one, verified by `apps/terminay-server/test/health-server.test.mjs`
- [x] 1.6 Handle signals and graceful shutdown with bounded timeouts
- [x] 1.7 Make composition startup failure-safe before the authenticated UI listener: a partially started service hook rolls back exactly once, never starts or stops the listener, and repeated shutdown cannot repeat cleanup, verified by `apps/terminay-server/test/runtime-composition.test.mjs`

## 2. Embedded supervision

- [x] 2.1 Start exactly one Local server from Desktop with a private bootstrap channel and a random short-lived credential, verified by `apps/terminay-desktop/test/local-server.test.mjs` and `desktop-bootstrap-integration.test.mjs`
- [x] 2.2 Select a collision-safe loopback endpoint by binding `127.0.0.1:0`, verified by starting two listeners concurrently in `runtime-composition.test.mjs` and observing distinct ports
- [x] 2.3 Prevent concurrent reuse of a data root with an atomic mode-0600 `FileDataRootLease` that never silently steals a stale lock
- [x] 2.4 Report readiness and stable server identity before opening the workspace
- [x] 2.5 Detect crash versus deliberate shutdown and provide retry/recovery without starting two authorities
- [x] 2.6 Coalesce concurrent shared embedded bootstrap starts before authority claim, credential minting, or readiness publication, verified by `apps/terminay-server/test/bootstrap.test.mjs`
- [x] 2.7 Make embedded stop join an in-flight bootstrap start and share one teardown of runtime, endpoint, and lease across concurrent stops, verified by `bootstrap.test.mjs`
- [x] 2.8 Keep the server alive through renderer/window reload and apply explicit `application` versus `last-window` shutdown policy, always stopping on application quit, verified by `local-server.test.mjs`

## 3. Standalone CLI

- [x] 3.1 Implement `start`, `status`/`version`, and pairing/exposure entry points that do not require a display
- [x] 3.2 Print readiness, data and log paths, and pairing instructions without leaking secrets into unrelated diagnostics
- [x] 3.3 Support configuration through documented flags, environment, and config with deterministic precedence and validation
- [x] 3.4 Provide foreground operation first and example service-manager units without making daemonization part of application correctness
- [x] 3.5 Make the one-container Compose example advertise a direct loopback protocol endpoint (`4317` bound `0.0.0.0` inside the container, `127.0.0.1:4317` on the host), emit `http://localhost:4317` pairing URLs, retain health on `8080`, and set a writable `/var/lib/terminay` HOME, verified by `apps/terminay-server/test/docker-contract.test.mjs`

## 4. Local protocol and UI bundle

- [x] 4.1 Serve the exact bundled responsive workspace manifest and assets from an authenticated local origin
- [x] 4.2 Implement the shared protocol handshake on the selected local transport, establishing server identity, negotiated capabilities, bounded limits, and bootstrap authorization before workspace access
- [x] 4.3 Expose authenticated query/command envelopes for registered server-core operations on local HTTP, bound to a completed handshake and its authorization scope, using the canonical envelope and body budget with no smaller operation cap and per-client command idempotency
- [x] 4.4 Preserve representative query, command, bounded binary-body, and correlation-scoped cancellation behaviour on framed local and headless transports, verified by `packages/server-core/test/remote-local-conformance.test.mjs`
- [x] 4.5 Carry the validated JSON envelope plus bounded raw bytes without base64 expansion on local HTTP, with malformed-frame and oversize cases, verified by `apps/terminay-server/test/local-ui-server.test.mjs`
- [x] 4.6 Abort only the matching operation on a local HTTP disconnect, including for framed raw-binary commands, verified by `apps/terminay-server/test/local-ui-cancellation.test.mjs`
- [x] 4.7 Propagate an operation deadline into the handler's abort signal and return the same bounded `deadline` result on both transports, verified by `local-ui-framed-conformance.test.mjs`
- [x] 4.8 Emit one validated cancel envelope after command acceptance from framed clients and abort only the matching request, verified by `packages/client-core/test/client.test.mjs` and `packages/server-core/test/cancellation-transport.test.mjs`
- [x] 4.9 Dispatch the same query, command, and raw-binary registry from local HTTP and framed transports with matching results, including the same canonical `not_found`, `forbidden`, and retryable `deadline` results and the same raw-binary query body budget, verified by `local-ui-framed-conformance.test.mjs`
- [x] 4.10 Merge the server-owned AI, Git, and recording protocol authorities into the canonical registry used by embedded framed and local HTTP hosts, verified by the enumerated surface in `packages/server-core/test/server-composition.test.mjs`
- [x] 4.11 Add a server-owned settings authority for revisioned `settings.get`/`settings.update`/`settings.reset` with conflict results, operation scopes, and `settings.changed` journal events, composed only with a concrete durable `ServerSettingsRepository`, verified by `packages/server-core/test/settings-protocol.test.mjs`
- [x] 4.12 Derive optional capability advertisement from supplied authorities so AI, Git, recordings, macros, and settings are absent from minimal embedded composition, and carry a real standalone settings query/update over authenticated HTTP, verified by `server-composition.test.mjs` and `standalone-http-transport.test.mjs`
- [x] 4.13 Compose a durable standalone macro repository bound to the exact server-owned PTY identity for bounded text, supported key, and inactivity steps, keeping secret and clipboard steps unavailable without explicit authorities, verified by `standalone-http-transport.test.mjs`
- [x] 4.14 Compose standalone recordings with a private data-root-backed library bound to non-replay PTY output and terminal exit, proving start, stop, list, and bounded replay without exposing storage paths, verified by `standalone-http-transport.test.mjs`
- [x] 4.15 Bind the standalone Git authority asynchronously to only the configured canonical `default` project root before readiness, advertise `git` only after composition, and enforce response-sized status/diff/worktree limits without accepting an arbitrary cwd, verified by `standalone-http-transport.test.mjs`
- [x] 4.16 Keep AI capability absent unless a host supplies a complete `AiService` authority, verified by `local-ui-framed-conformance.test.mjs`
- [x] 4.17 Add explicit `--ai-providers` / `TERMINAY_AI_PROVIDERS` opt-in for the bounded Codex and Claude Code CLI adapters, passing only a small allowlisted provider environment and never accepting API keys as flags, verified by `standalone-http-transport.test.mjs`
- [x] 4.18 Preserve the full terminal lifecycle beyond attach/input/kill over authenticated HTTP — resize records the requested dimensions, acknowledgement retains its exact position, detach retires the attachment, resume returns a new one — verified by `standalone-http-transport.test.mjs`
- [x] 4.19 Compose bounded server-owned File Viewer content operations for the standalone `default` project and query `file.text-metadata` after handshake, receiving canonical metadata only, verified by `standalone-http-transport.test.mjs`
- [x] 4.20 Carry the canonical file catalog operations over authenticated HTTP — list, `files.create` with a bounded raw binary body, `files.content-range`, `files.search`, `files.rename`, `files.create-directory`, `files.delete`, `files.tasks`, `files.content-hex`, `files.size`, `files.content-preview`, and `files.content-capabilities` — verified by `standalone-http-transport.test.mjs`
- [x] 4.21 Compose the server-owned file editor session registry over authenticated HTTP: open, `files.edit` raw draft bytes, save, read persisted text, `files.metadata`, `files.read-range`, and close, verified by `standalone-http-transport.test.mjs`
- [x] 4.22 Carry the destructive file-session reconciliation operations over authenticated HTTP so a dirty draft rejects `files.reload` without confirmation as a structured JSON protocol value rather than a transport-level 500, confirmed reload resets the draft, and `files.keep-local` preserves the acknowledged draft through its following save, verified by `standalone-http-transport.test.mjs`
- [x] 4.23 Carry `activity.snapshot`, `activity.delta`, and `activity.acknowledge` over authenticated HTTP with revision/cursor-consistent replay and the authoritative attention/acknowledged transition, verified by `standalone-http-transport.test.mjs`
- [x] 4.24 Compose the standalone local HTTP endpoint with the same terminal operation registry used by embedded/framed transports and create a default `default/default` PTY session for browser attach, verified by `standalone-http-transport.test.mjs`
- [x] 4.25 Prove the local Docker Compose web host can connect through nginx to the standalone authenticated local HTTP protocol, query health, see the default session, and reconnect after a server-only restart without exposing pairing tokens, verified by `scripts/docker-compose-web-server-smoke.mjs` and its recorded evidence
- [x] 4.26 Add bounded output/event replay and subscriptions with snapshot resync across a local UI transport restart
- [x] 4.27 Keep endpoint and token URLs out of browser history, logs, and connection metadata by using header-only credentials and `Referrer-Policy: no-referrer`

## 5. Packaging

- [x] 5.1 Prove the npm-packed standalone payload is byte-reproducible across two packs, contains the declared CLI, MCP, server, and release-integrity entries without source or Electron payload, runs its integrity check before `--version` from an isolated symlink-free closure, and creates its default PTY session before reporting readiness, verified by `scripts/standalone-artifact.test.mjs`
- [x] 5.2 Define a native Linux x64/arm64 CI matrix that builds the archive twice from compiled payloads and an isolated production closure, compares archive hashes, rejects source/Electron paths, and uploads the target-specific artifact, verified by `scripts/standalone-server-artifact-ci.test.mjs`
- [x] 5.3 Remove compiler/build-tool availability before upload and run the archive's own target-matched extraction, manifest, ELF, and bounded CLI-version probe, with the wiring guarded by `standalone-server-artifact-ci.test.mjs`
- [x] 5.4 Record and immediately verify a machine-readable evidence file binding archive byte count and SHA-256 to the full Git commit and native runner identity, failing closed on cross-target, cross-commit, symlink, and substituted-byte records, verified by `scripts/record-native-runner-evidence.test.mjs`
- [x] 5.5 Provide a native-Linux-only archive probe that inventories and extracts the target archive, verifies manifest inventory and Node/`node-pty` ELF architectures, executes `terminay-server --version` with a bounded timeout, and refuses to emulate Linux binaries on another host, verified by `scripts/standalone-server-archive-probe.test.mjs`
- [x] 5.6 Reject an executable manifest entry replaced by a symlink even when its target has the expected bytes, binding verification to regular files inside the extracted artifact, verified by `apps/terminay-server/test/release-integrity.test.mjs`
- [x] 5.7 Compose the Electron-free embedded Local bootstrap onto `createEmbeddedServer` with the same authenticated `LocalUiServer` used by standalone, serving a verified manifest and byte-exact asset, verified by `bootstrap.test.mjs`
- [x] 5.8 Make Desktop's Local supervisor inject its one-time credential into the shared `@terminay/server` embedded bootstrap rather than constructing a Desktop-only server or listener, verified by `apps/terminay-desktop/test/embedded-runtime.test.mjs`
- [x] 5.9 Reject an unauthenticated manifest request from the embedded bundle listener while serving the verified manifest and byte-exact asset with the credential, verified by `bootstrap.test.mjs`
- [x] 5.10 Roll back listener, endpoint claim, and services when the private readiness handoff fails, without letting listener teardown prevent service cleanup, verified by `bootstrap.test.mjs`
- [x] 5.11 Apply the same authenticated listener boundary and coalesced concurrent `start()` behaviour in standalone and embedded runtimes, verified by `runtime-composition.test.mjs`
- [x] 5.12 Prove an extracted symlink-free Desktop package starts its extracted `@terminay/server` dependency through `createDesktopEmbeddedLocalServer`, serves the authenticated manifest and byte-exact asset, resolves `node-pty` from its staged closure and runs a real PTY, loads the shared provider-CLI adapter, and recovers across a deliberate stop/restart, verified by `apps/terminay-desktop/test/embedded-runtime-artifact.test.mjs`
- [x] 5.13 Reject a hash-valid UI bundle whose declared server version does not match the embedded runtime before binding the loopback listener, verified by `apps/terminay-desktop/test/embedded-ui-artifact-integrity.test.mjs`
- [x] 5.14 Reject an expired private bootstrap credential before constructing the shared embedded listener, verified by `embedded-runtime-artifact.test.mjs`
- [x] 5.15 Statically constrain the Desktop embedded adapter to delegate runtime construction to `@terminay/server`, preventing reintroduction of an Electron-only import, `LocalUiServer`, or `ServerRuntime` construction, verified by `embedded-runtime-artifact.test.mjs`
- [x] 5.16 Deterministically resolve and inspect the declared development, standalone, and packaged Desktop entrypoint layouts and record non-executing resolution declarations for `node-pty`, provider CLIs (`TERMINAY_CODEX_COMMAND || codex`, `TERMINAY_CLAUDE_CODE_COMMAND || claude`), `0700` managed hook scripts under `.terminay/agent-hooks` with loopback-only delivery, the `terminay-mcp`/`dist/mcpEntry.js` server MCP entry, and Desktop assets under `dist-electron/**`, verified by `scripts/task6-runtime-layout.test.mjs`
- [x] 5.17 Execute the packed standalone `terminay-mcp`, `--pairing`, `--status`, and foreground health entries from the isolated closure, proving integrity verification, fail-closed behaviour without an inherited control socket, fragment-only pairing records, redacted diagnostics with flag precedence, the bounded unauthenticated `/healthz` and `/readyz` contract without CORS, and clean SIGTERM exit, verified by `scripts/standalone-artifact.test.mjs`, `scripts/task6-packed-cli-status.test.mjs`, and `scripts/task6-packed-cli-health.test.mjs`
- [x] 5.18 Execute the staged shared server's `terminay-mcp`, `--pairing`, `--status`, and foreground entries from the extracted Desktop package's production closure with the same guarantees, verified by `embedded-runtime-artifact.test.mjs`
- [x] 5.19 Cover the compiled development server's real `mcpEntry.js` by its release-integrity manifest and fail closed when the inherited control socket is absent, verified by `scripts/task6-development-mcp-entry.test.mjs`
- [x] 5.20 Reconcile real managed Codex and Claude hook configurations and `0700` scripts into an isolated HOME from the packed standalone payload, the extracted Desktop package, and the compiled development layout, with no endpoint or token secrets in provider configs, verified by `scripts/standalone-artifact.test.mjs`, `apps/terminay-desktop/test/embedded-provider-hooks-artifact.test.mjs`, and `scripts/task6-development-runtime.test.mjs`
- [x] 5.21 Execute bounded provider model-discovery child processes from the packed standalone and compiled development closures, verified by `standalone-artifact.test.mjs` and `task6-development-runtime.test.mjs`
- [x] 5.22 Keep a custom composed Codex driver authoritative for asynchronous hook normalization, applying built-in transcript enrichment only to the built-in Codex driver, verified by `packages/server-core/test/agent-protocol.test.mjs`
- [x] 5.23 Resolve the compiled standalone listener's verified manifest and nested unpacked UI assets from an absolute unpacked payload directory regardless of the process working directory, verified by `apps/terminay-server/test/standalone-unpacked-assets.test.mjs`
- [x] 5.24 Resolve and execute `node-pty` only from the staged symlink-free closure against a hostile cwd and `NODE_PATH`, running a bounded real PTY on supported Unix platforms, verified by `apps/terminay-server/test/packed-node-pty-layout.test.mjs` and `scripts/task6-development-node-pty.test.mjs`
- [x] 5.25 Execute the compiled development standalone `--pairing` path after release-integrity preflight, emitting only a short-lived fragment-only bootstrap record without starting the listener or creating server state, verified by `apps/terminay-server/test/standalone-pairing-handoff.test.mjs`
- [x] 5.26 Add deterministic standalone artifact version/manifest checks with payload hashes, pinned Node metadata, required entrypoints, provenance pointers, and Electron-import rejection, leaving signing and native certification as separate release gates

## 6. Acceptance checks

- [x] 6.1 Run one server test suite against both headless and embedded launch modes, verified by the shared lifecycle assertions applied to `createStandaloneServer` and `createEmbeddedServer` in `runtime-composition.test.mjs`
- [x] 6.2 Restart a crashed Local server from Desktop without corrupting or duplicating state, with concurrent recovery callers coalescing on one replacement after the crashed authority is retired, verified by `local-server.test.mjs`
- [x] 6.3 Keep the server and PTYs alive when every renderer closes while the selected Desktop lifecycle remains active, stopping only on application quit, verified by `local-server.test.mjs`
- [x] 6.4 Prove `./terminay-server`-style foreground startup on a clean supported Linux host with a non-root, read-only image and an isolated writable data volume, reaching `/readyz` and exiting `0` on SIGTERM, verified by `apps/terminay-server/test/docker-foreground-smoke.mjs` invoked only with an explicitly supplied image tag
- [x] 6.5 Load the server's exact authenticated local bundled UI in a browser host and complete the shared protocol handshake, verified by `apps/terminay-server/test/standalone-browser-ui-handshake.test.mjs`
- [x] 6.6 Prove no Electron import exists in the standalone server dependency graph, verified by `apps/terminay-server/test/standalone-dependency-graph.test.mjs`

> **Operational release follow-up (not project code).** Before a release claims native
> Linux artifact execution, both the native GitHub-hosted Linux x64 and `ubuntu-24.04-arm`
> matrix jobs must produce verified archive and evidence pairs. This is hosted release
> evidence rather than remaining implementation; see design.md - Risks / Trade-offs.
