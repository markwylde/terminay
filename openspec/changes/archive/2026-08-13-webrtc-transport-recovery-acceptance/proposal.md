## Why

Nothing proved that a mounted workspace survived a real WebRTC transport
failure. The former browser convergence test used Local Network pairing and
fell back to a WebSocket transport, so it never exercised WebRTC at all; the
headless WebRTC proof covered pairing and a full page reconnect but not failure
of a mounted page, and its clean Linux wrapper omitted the application build, so
it could fail before loading the renderer it claimed to test.

## What Changes

- **BREAKING** Completion or failure of the server application-protocol reader
  is treated as failure of the whole host-owned transport generation, even when
  the native peer and every required data channel remain open.
- That failure is delivered once, with the exact generation identity, to the
  unified renderer recovery controller, which retires the stale application
  client, peer, lanes, subscriptions, and attachments before replacement begins.
- Automatic recovery and manual Retry create a fresh host generation instead of
  consulting, awaiting, or reusing stale peer or channel state.
- A permanent native failure matrix injects independent faults for the
  `control`, `application`, `terminal`, and `assets` lanes, peer and ICE state
  transitions, host shutdown, exposure stop, and device revocation.
- Bootstrap-only `api` and `asset` lanes are proven closed and unreachable after
  the canonical application handoff.
- The renderer generation is bounded end to end, so a transport that acquires an
  endpoint but never becomes usable returns to retry-wait instead of trapping
  Retry behind an in-flight generation.
- First-failure diagnostics become metadata-only and typed, replacing broad
  `client is not connected` recovery text while keeping safe user-facing
  language.
- Tests whose descriptions claimed WebRTC recovery while selecting WebSocket or
  only reconnecting after page close are removed or renamed.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: one host-owned transport generation per mounted workspace,
  with explicit liveness signals and single-owner replacement.
- `terminal-stream-congestion-and-recovery`: protocol liveness is generation
  liveness, recovery outcomes are typed, and post-recovery workspace and
  terminal identity is asserted.

## Impact

The host WebRTC transport generation owner, the unified renderer recovery
controller, terminal panel input queueing and presentation renewal, the native
Linux WebRTC proof harness and its fault injection, recovery diagnostics, and
the release workflow gates. Evidence links in the embedded exposure and
browser-host convergence records now point at this matrix instead of duplicating
partial reconnect scenarios.
