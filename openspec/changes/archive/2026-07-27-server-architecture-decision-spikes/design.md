## Context

The pre-extraction application depended on Electron for WebRTC hosting, native
PTY packaging, filesystem paths, and secret storage. The target runtime has to
run headlessly on Linux servers with no display, and it has to serve UI into
client boundaries that are untrusted by construction. Each of those was a
hard-to-reverse choice, so this change bought proof before implementation.

The spike deliberately scoped itself to *selection*. It did not certify the
release matrix: native release-runner results, oldest-OS compatibility, signed
installers, sustained multi-peer capacity, SBOM and attestation, and
clean-machine release acceptance were left as explicit gates in the security,
release, and operations work.

## Goals / Non-Goals

Goals:
- Prove, with running code, that each high-risk runtime choice has a viable
  path.
- Select exactly one approach per spike and record the evidence, the supported
  platforms, the constraints, and the fallback.
- Stop before foundation implementation if any required headless or security
  property had no viable path.

Non-Goals:
- Release certification on native runners or the oldest supported OS versions.
- Sustained real multi-peer capacity measurement.
- Signed installers, SBOM, or provenance.

## Decisions

### Headless WebRTC runtime

Both candidates were exercised through the real hosted signaling service in
displayless plain Node. `node-datachannel` passed the complete production flow
on native Linux arm64 — first pairing, origin-bound device keys, two-factor
saved reconnect, closed-envelope signed signaling, exact channel shape,
per-transfer asset pressure, one-request-per-peer admission, terminal traffic,
revocation, and natural exit. Werift was then integrity-pinned and minimized so
that the executable graph excludes the high-advisory legacy ICE dependency; the
minimized artifact reports zero npm advisories and passes the same production
flow plus Node 22, Electron main and child, native Linux arm64, and emulated
Linux x64 runtime proofs. The Terminay-owned deterministic Werift ESM artifact
was selected.

`scripts/production-webrtc-turn-routes.test.mjs` additionally proved terminal
traffic over a selected direct host/peer-reflexive route and over a forced
authenticated TURN-only relay/relay UDP route, with selected-pair statistics
nominated and succeeded at both relay peers. Wrong and expired credentials
produce neither a selected pair nor terminal traffic.

`scripts/webrtc-headless-resource-limits.test.mjs` drove twelve concurrent
instances of the production `runHost` surface and proved the fixed three-channel
shape, the four-chunk-per-peer asset acknowledgement window, proportional
aggregate pressure, API and terminal progress behind a stalled asset consumer,
explicit transfer cancellation, relay-loss reporting, peer-crash isolation,
revocation, listener removal, and deterministic peer closure. A server-wide
admission ceiling and a real native multi-peer run remained open.

### Native PTY distribution

`node-pty` was kept, with one supervised child per PTY. The same native module
runs under plain Node and under an Electron-supervised child; a real Electron
browser-main process forks and supervises the built host over process IPC; the
unpacked native addon, executable spawn helper, and host module work inside an
unsigned packaged macOS arm64 application; and the extracted x64 AppImage
validates its ELF native addon, rejects host cwd and module-loader resolution,
requires the exact packaged resources and PTY-host entry, and satisfies the
packaged PTY behaviour contract.

`scripts/pty-runtime-artifact-probe.mjs` executed the same behaviour contract
from deterministic bundled-Node archives in clean compiler-free Linux targets.
The local arm64 lane was native; the local x64 lane was explicitly
architecture-emulated. A local x64 QEMU attempt reached the TypeScript build
and then terminated with a QEMU segmentation fault before producing the
AppImage — recorded rather than papered over.

### Persistence and vault

SQLite through `node:sqlite` was selected for the state repository.
`scripts/server-state-sqlite-crash.test.mjs` proved uncommitted rollback,
committed durability, transactional migration recovery, online backup and
recovery beside unchanged corrupt evidence, WAL reader availability, bounded
writer contention, stale-revision conflict, and integrity after process death.

One vault interface was defined with embedded and headless implementations.
`scripts/safe-storage-import.test.mjs` runs Electron safe storage, imports the
decrypted value directly into an encrypted SQLite vault record, kills the
migration at nine boundaries, proves idempotent recovery, rejects Linux
`basic_text`, and scans the complete isolated profile, temp, log, trace, and
crash tree for plaintext artifacts. `scripts/vault-reference.test.mjs` exercises
the interface with Electron and headless protectors, an authenticated versioned
envelope, bounded scrypt and input resources, one-shot inherited key FDs,
wrong-key, tamper, and zeroization behaviour, same-key nonce uniqueness,
cross-protector rewrap, and atomic snapshot recovery across process death. A
design that stores the encryption key beside its ciphertext was explicitly
rejected. Complete-old-snapshot rollback freshness stays the state repository's
expected-revision responsibility.

### Client-host composition

`e2e/server-ui-sandbox.spec.ts` loads a hostile server bundle through the
dedicated Desktop host and preload and proves origin, frame, partition,
navigation, permission, download, popup, storage, and bridge isolation.
`e2e/web-client-host.spec.ts` uses distinct parent, two session, and attacker
origins to prove the closed host-message contract, credential and application
storage isolation, responsive framing, input focus, clipboard delegation, CSP,
`frame-ancestors`, and navigation containment. The iOS Safari mobile-viewport
spike ran the exact-origin composition with real xterm in an iOS 26.5 Safari
simulator: the software keyboard shrinks the visual viewport, typed keys reach
xterm, terminal content stays inside the visible bounds, and geometry restores
after dismissal.

## Risks / Trade-offs

- The x64 PTY archive evidence is architecture-emulated, not native. Native
  x64 and arm64 CI, packaged Linux x64, macOS 12 acceptance, and clean release
  machines remained release gates rather than spike outcomes.
- The minimized Werift artifact is Terminay-owned, so Terminay carries the cost
  of tracking upstream changes and re-deriving the artifact deterministically.
- Per-peer WebRTC pressure and cleanup are proven, but a server-wide admission
  ceiling and sustained real multi-peer capacity are not.
- The strict follow-up audit kept the affected boxes open until one headless
  WebRTC candidate passed the production pairing, two-factor reconnect,
  signed-signal, bounded-transfer, revocation, representative Linux, and
  shutdown gates together.

## Open Questions

- Server-wide WebRTC admission ceiling and native sustained multi-peer capacity
  (deferred to the release and operations gates).
- Oldest-supported-OS acceptance and signed installer behaviour on clean
  machines (deferred to the release and operations gates).
