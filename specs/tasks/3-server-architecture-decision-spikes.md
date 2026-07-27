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

## Dependencies

None.

## Work slices

### Headless WebRTC

- [ ] Run the production signaling flow from a displayless Node process on
  Linux x64 and arm64.
- [ ] Compare maintained Node WebRTC runtimes for data-channel behaviour,
  ICE/STUN/TURN, native distribution, Electron compatibility, shutdown,
  resource use, and security maintenance.
- [ ] Prove first pairing, reconnect, signed signaling, isolated channels, and
  bounded asset transfer through the existing hosted service.
- [ ] Select one runtime and record exact fallback/blocking evidence.

### Native PTY distribution

- [ ] Run the existing PTY host from plain Node and from an
  Electron-supervised child using the same module.
- [ ] Produce and exercise Linux x64/arm64 plus supported Desktop distribution
  candidates without requiring compilers on the target machine.
- [ ] Verify signals, process trees, cwd, UTF-8, foreground-process inspection,
  and bounded shutdown.
- [ ] Select the standalone artifact format that supports the requested
  `./terminay-server` experience.

### Persistence and vault

- [ ] Compare storage backends against atomic multi-object commits, revision
  lookup, migrations, corruption recovery, backup, and concurrent clients.
- [ ] Prove the chosen candidate with an interrupted-write recovery test.
- [ ] Define one vault interface with embedded and headless implementations.
- [ ] Prove Electron safe-storage import without plaintext migration files.
- [ ] Select and document headless unlock/key management; reject a design that
  stores the encryption key beside its ciphertext.

### Client-host composition

- [ ] Prove a sandboxed Electron view loading server-provided UI with Node
  disabled and only a narrow, validated host bridge.
- [ ] Prove `web.terminay.com` as a parent connection shell around an
  exact-origin session view, or select a simpler model with the same origin and
  credential isolation.
- [ ] Verify xterm keyboard focus, clipboard permission, resizing, CSP,
  navigation blocking, mobile viewport/virtual keyboard, and
  `frame-ancestors`.
- [ ] Prove the host cannot read session-origin IndexedDB, cookies, device keys,
  reconnect grants, or workspace data.

### Decision records

- [ ] Record one selected approach, evidence, supported platforms, constraints,
  and fallback for every spike.
- [ ] Update the governing feature contracts where a selected constraint
  changes product behaviour.
- [ ] Stop before foundation implementation if a required headless or security
  property has no viable path.

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
