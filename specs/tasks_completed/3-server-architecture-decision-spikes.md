# Server architecture decision spikes

## Goal

Resolve the high-risk runtime choices with executable proofs before changing
product behaviour or committing the repository to hard-to-reverse foundations.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

## Why this is active

The current application relies on Electron for WebRTC hosting, native PTY
packaging, paths, and safe storage. The target also runs displayless on common
Linux servers and loads server-provided UI inside untrusted client boundaries.
Those constraints need proof before extraction begins.

This task selects viable architecture and packaging approaches. It does not
certify the final release matrix. Native release-runner results, oldest-OS
compatibility, signed installers, sustained capacity, SBOM/attestation, and
clean-machine release acceptance remain explicit gates in
[security, release, and operations](../tasks/20-security-release-and-operations.md).

## Dependencies

None.

## Work slices

### Headless WebRTC

- [x] Run the production signaling flow from a displayless Node process with
  the selected architecture-neutral runtime, and exercise that same artifact
  in clean Linux x64 and arm64 environments. Native release-runner
  certification remains Task 20.
- [x] Compare maintained Node WebRTC runtimes for data-channel behaviour,
  ICE/STUN/TURN, native distribution, Electron compatibility, shutdown,
  resource use, and security maintenance.
- [x] Prove first pairing, reconnect, signed signaling, isolated channels, and
  bounded asset transfer through the existing hosted service.
- [x] Prove reconnect requires both the origin-bound device private key and its
  grant; the relay cannot derive signaling keys; signatures bind the complete
  closed envelope; invalid signatures cannot consume a nonce; and exact valid
  replays are rejected.
- [x] Force direct/STUN and authenticated TURN-only routes with structured ICE
  credentials, then prove bounded application-channel pressure, revocation,
  and cleanup. Sustained real multi-peer capacity remains Task 20.
- [x] Select one runtime and record exact fallback/blocking evidence.

### Native PTY distribution

- [x] Run the existing PTY host from plain Node and from an
  Electron-supervised child using the same module.
- [x] Record the initial platform matrix and minimum GNU/Linux ABI: Desktop
  macOS 12 Monterey or newer on arm64 and Linux x64; standalone Server
  GNU/Linux x64 and arm64 on a Debian 12-compatible userspace with glibc 2.36
  or newer; all other targets unsupported.
- [x] Produce compiler-free standalone PTY candidates for Linux x64/arm64 and
  packaged Desktop candidates, then execute the complete behavior probe on
  representative native and architecture-emulated targets. Native release
  runners, the oldest supported OS versions, and clean-machine installer
  acceptance remain Task 20.
- [x] Verify signals, process trees, cwd, UTF-8, foreground-process inspection,
  and bounded shutdown.
- [x] Select the standalone artifact format that supports the requested
  `./terminay-server` experience.

### Persistence and vault

- [x] Compare storage backends against atomic multi-object commits, revision
  lookup, migrations, corruption recovery, backup, and concurrent clients.
- [x] Prove the chosen candidate with an interrupted-write recovery test.
- [x] Define one vault interface with embedded and headless implementations.
- [x] Prove Electron safe-storage import without plaintext migration files.
- [x] Select and document headless unlock/key management; reject a design that
  stores the encryption key beside its ciphertext.
- [x] Prove the versioned envelope, exact bounded KDF parameters, wrong-key and
  tamper behavior, lock/rewrap/recovery, inherited key-FD lifecycle, and
  plaintext-free failure paths.

### Client-host composition

- [x] Prove a sandboxed Electron view loading server-provided UI with Node
  disabled and only a narrow, validated host bridge.
- [x] Prove `web.terminay.com` as a parent connection shell around an
  exact-origin session view, or select a simpler model with the same origin and
  credential isolation.
- [x] Verify xterm keyboard focus, clipboard permission, resizing, CSP,
  navigation blocking, mobile viewport/virtual keyboard, and
  `frame-ancestors`.
- [x] Prove the host cannot read session-origin IndexedDB, cookies, device keys,
  reconnect grants, or workspace data.

### Decision records

- [x] Record one selected approach, evidence, supported platforms, constraints,
  and fallback for every spike.
- [x] Update the governing feature contracts where a selected constraint
  changes product behaviour.
- [x] Stop before foundation implementation if a required headless or security
  property has no viable path.

## Completion evidence

- Candidate storage, vault, PTY distribution, client-host, and pending WebRTC
  decisions are recorded in
  [server foundation decisions](../decisions/server-foundation.md).
- `scripts/server-state-sqlite-crash.test.mjs` proves uncommitted rollback,
  committed durability, transactional migration recovery, online backup and
  recovery beside unchanged corrupt evidence, WAL reader availability, bounded
  writer contention, stale-revision conflict, and integrity after process
  death.
- `scripts/safe-storage-import.test.mjs` runs Electron safe storage, imports the
  decrypted value directly into an encrypted SQLite vault record, kills the
  migration at nine boundaries, proves idempotent recovery, rejects Linux
  `basic_text`, and scans the complete isolated profile/temp/log/trace/crash
  tree for plaintext artifacts.
- `scripts/vault-reference.test.mjs` exercises the extraction-shaped vault
  interface with Electron and headless protectors, an authenticated versioned
  envelope, bounded scrypt and input resources, one-shot inherited key FDs,
  wrong-key/tamper/zeroization behavior, same-key nonce uniqueness,
  cross-protector rewrap, and atomic snapshot recovery across process death.
  Complete-old-snapshot rollback freshness remains the state repository's
  expected-revision responsibility.
- `scripts/pty-host-runtime.test.mjs` runs the emitted PTY host under plain Node
  and Electron Node mode with the same native module.
- `scripts/pty-electron-main-supervisor.test.mjs` launches a real Electron
  browser-main process which forks and supervises that same built host over
  process IPC. `scripts/pty-packaged-macos.test.mjs` exercises the unpacked
  native addon, executable spawn helper, and host module inside an unsigned
  packaged macOS arm64 application. The supported Desktop matrix is macOS
  arm64 and GNU/Linux x64; signing, notarization, and installer acceptance
  remain release gates.
- `scripts/pty-runtime-artifact-probe.mjs` executes the same behavior contract
  from deterministic bundled-Node archives in clean compiler-free Linux
  targets. The local arm64 lane is native and the local x64 lane is explicitly
  architecture-emulated. This proves the selected archive and native-module
  strategy is viable without claiming final release certification. Native
  x64/arm64 CI, packaged Linux x64, macOS 12 acceptance, and clean release
  machines remain Task 20 gates.
- `scripts/pty-packaged-linux.test.mjs` extracts the x64 AppImage, validates its
  ELF native addon, rejects host cwd/module-loader resolution, requires the
  exact packaged resources and PTY-host entry, launches the packaged Electron
  browser main process, and applies the packaged PTY behavior contract. Native
  Debian 12 CI lanes build native dependencies at the glibc 2.36 floor, remove
  compilers before the probes, and cover standalone x64/arm64 plus the Linux
  x64 AppImage. The CI harness retains its container Node executable, while
  the PTY host itself runs through the archive's bundled Node; the separate
  clean-target evidence establishes operation without system Node or npm. A
  successful lane establishes the supported userspace floor; older kernels and
  other distributions remain release-matrix variation. These configured lanes
  are not completion evidence until they pass. A local x64 QEMU attempt reached
  the TypeScript build and then terminated with a QEMU segmentation fault
  before producing the AppImage.
- [Production headless WebRTC Linux evidence](../decisions/evidence/production-headless-webrtc-linux.md)
  records clean execution of the exact deterministic minimized-Werift artifact
  on native arm64 and architecture-emulated x64 Linux. Both lanes pass the
  bounded Node 22 peer/data-channel and clean-shutdown proof with a
  zero-vulnerability production audit. The non-selected node-datachannel
  candidate also passes the full production flow on native Linux arm64.
  Matching native x64/arm64 CI remains a Task 20 certification gate.
- `e2e/server-ui-sandbox.spec.ts` loads a hostile server bundle through the
  dedicated Desktop host/preload and proves origin, frame, partition,
  navigation, permission, download, popup, storage, and bridge isolation.
- `e2e/web-client-host.spec.ts` uses distinct parent, two session, and attacker
  origins to prove the closed host-message contract, credential/application
  storage isolation, responsive framing, input focus, clipboard delegation,
  CSP, `frame-ancestors`, and navigation containment.
- `scripts/webrtc-headless-resource-limits.test.mjs` drives twelve concurrent
  instances of the production `runHost` surface with deterministic
  peer/channel doubles and proves the fixed three-channel shape, the
  four-chunk-per-peer asset acknowledgement window, proportional aggregate
  pressure, API and terminal progress behind a stalled asset consumer,
  explicit transfer cancellation, relay-loss reporting, peer-crash isolation,
  revocation, listener removal, and deterministic peer closure. This is
  executable evidence for per-peer pressure and cleanup; a server-wide
  admission ceiling and a real native multi-peer run remain open.
- [Production `node-datachannel` headless integration evidence](../decisions/evidence/node-datachannel-production-headless-spike.md)
  runs the production remote service and WebRTC coordinator in displayless
  plain Node against the real hosted signaling server and bundled browser
  client. It proves first pairing, origin-bound device keys, two-factor saved
  reconnect, closed-envelope signed signaling, exact channels, per-transfer
  asset pressure, one-request-per-peer admission, terminal traffic, revocation,
  and natural exit. Clean Linux production runs, selected-route measurement,
  authenticated TURN-only routing, and native capacity remain open.
- [Secure Werift production-runtime evidence](../decisions/evidence/secure-werift-production-spike.md)
  integrity-pins and minimizes the published ESM artifact so the executable
  graph excludes the high-advisory legacy ICE dependency. It reports zero npm
  advisories and passes the same production pairing, two-factor reconnect,
  signed-signal, bounded-asset, terminal, revocation, and natural-exit flow.
  The deterministic artifact also passes Node 22, Electron-main/child, native
  Linux arm64, and emulated Linux x64 runtime proofs. Native release
  certification, sustained multi-peer limits, and release provenance remain
  Tasks 17/20.
- `scripts/production-webrtc-turn-routes.test.mjs` rebuilds and audits the
  minimized Werift artifact, preserves an ephemeral coturn REST secret in a
  mode-0600 file, and runs the production `runHost` surface. It proves terminal
  traffic over a selected direct host/peer-reflexive route and a forced
  authenticated TURN-only relay/relay UDP route. Selected-pair stats are
  nominated and succeeded at both relay peers. Wrong and expired credentials
  produce neither a selected pair nor terminal traffic. The focused service
  tests also prove strict structured ICE parsing, redacted validation, and
  credential-preserving `RemoteAccessService` host configuration. Task 17
  carries that contract through the extracted server coordinator.
- [iOS Safari xterm mobile-viewport evidence](../decisions/evidence/ios-safari-mobile-viewport-spike.md)
  runs the exact-origin composition with real xterm in an iOS 26.5 Safari
  simulator. The actual software keyboard shrinks the visual viewport, typed
  keys reach xterm, terminal content remains inside the visible bounds, and
  geometry restores after dismissal.
- Strict follow-up audit keeps the affected boxes open until one headless
  WebRTC candidate passes the production pairing, two-factor reconnect,
  signed-signal, bounded-transfer, revocation, representative Linux, and
  shutdown gates. Task 17 carries structured settings through the complete
  extracted-server coordinator; this spike proves the selected structured
  contract, service preservation, and direct/TURN route behavior.

## Acceptance checks

- A displayless Node process completes a production-equivalent WebRTC
  data-channel session.
- A standalone PTY runs from a clean supported Linux artifact.
- An injected interrupted state write recovers the last valid commit.
- Embedded legacy secrets import without a plaintext intermediate.
- A test server bundle inside Desktop has no Node or ambient preload access.
- A web parent cannot read session-origin credentials or application storage.

## Definition of done

Every high-risk decision has executable evidence and one selected approach.
The next foundation task contains no unresolved choice that would invalidate
its package, protocol, storage, WebRTC, PTY, or host boundaries.
