## Why

The product was one Electron/Vite package: renderer APIs were Electron preload
calls and the only remote protocol was terminal-specific, so a terminal could
not survive a window close and no non-Electron client could ever hold the same
contract. Moving service ownership to a server safely required an enforceable
dependency direction and one transport-neutral application contract first.

## What Changes

- Split the repository into independently buildable `terminay-desktop`,
  `terminay-server`, and `terminay-web` applications plus shared `protocol`,
  `client-core`, `responsive-ui`, `server-core`, and `protocol-conformance`
  packages, each with an explicit `exports` map.
- Define application protocol version 1: bounded binary frames with a magic
  value, wire-format version, frame-kind discriminator, fixed-width big-endian
  lengths, a canonical UTF-8 JSON header validated against a closed schema, and
  an optional raw body.
- Define the envelope set — hello/capabilities/incompatible-version,
  correlated query and idempotent command, ordered revision events, stream
  open/chunk/ack/close, binary-transfer start/chunk/ack/complete/fail,
  cancellation and deadlines, and the structured error taxonomy.
- Define `TerminayClient` — queries, commands, subscriptions, connection state,
  and error surface — and the framed byte-transport interface with explicit
  lifecycle states, bounded queue accounting, `waitForWritable`, and
  `AbortSignal` cancellation.
- Add a reusable protocol/transport conformance suite plus in-memory and
  framed Electron-IPC adapters, and a TypeScript-AST boundary checker wired
  into normal CI.
- **BREAKING** for internal consumers: the unversioned terminal-only remote
  message set becomes a legacy dialect, not protocol version 1; an
  unsupported version negotiation returns a closed `incompatible_version`
  error rather than partially parsing.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-runtime-and-protocol`: introduces the versioned, runtime-validated
  application protocol, its structured error and resync rules, the client
  interface boundary, and transport neutrality with a conformance suite.

## Impact

- New `apps/` and `packages/` workspace layout; all Desktop main, preload,
  renderer, asset, Vite, and Electron Builder configuration moved mechanically.
- Existing Electron-owned application services quarantined under
  `terminay-desktop/src/legacy-services/` behind one compatibility composition
  entry, with boundary tests rejecting growth of that surface.
- CI gains boundary validation, package type checking, deterministic
  double-build hash comparison, and three independent application builds.
