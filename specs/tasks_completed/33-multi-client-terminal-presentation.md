# Multi-client terminal presentation

## Goal

Let Desktop and browser clients observe one PTY reliably while ensuring exactly
one interactive emulator controls input, resize, and terminal-protocol replies,
with valid screen recovery for new and reconnecting clients.

## Governing specifications

- [Terminal workspace](../features/terminal-workspace.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Remote access](../features/remote-access.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)

## Dependencies

- [Task 31: Reliable ordered connection delivery](./31-reliable-ordered-connection-delivery.md)
- [Task 32: Workspace delta reconciliation](./32-workspace-delta-reconciliation.md)

## Current gap

Each attached xterm forwards its entire `onData` stream to the shared PTY.
`onData` includes both deliberate keyboard/paste input and automatic replies to
terminal queries such as OSC colour requests. Two attached emulators therefore
answer one PTY query twice; the duplicate reply can be consumed or echoed as
ordinary input. Filtering observed OSC 10/11 strings would leave the same flaw
for device attributes, status, cursor, focus, mouse, window, and future queries.

Resize has an ownership lease, but interactive input and emulator-generated
responses do not. Separately, initial replay can start at an arbitrary byte
offset inside retained ANSI/OSC output, which is not enough to reconstruct a
fresh emulator's screen and modes reliably.

## Implementation slices

### Interactive presentation lease

- [x] Define a server-owned lease for exact
  `{serverId, projectId, sessionId, clientId, attachmentId}` identity with
  bounded expiry, renewal, release, disconnect cleanup, revocation, and an
  observable revision.
- [x] Require explicit user intent to acquire or take over control. Attachment,
  focus, output receipt, reconnect, and background rendering do not silently
  steal it.
- [x] Gate the complete xterm `onData` stream and viewport changes by that
  lease. Non-holders render live output read-only and cannot send automatic
  terminal responses.
- [x] Present controller/read-only state and an accessible takeover action in
  wide and narrow clients. Resolve simultaneous takeover requests
  deterministically and audit metadata without recording terminal content.
- [x] Keep macro, dictation, and MCP writes on their separately authorized,
  ordered server input paths without granting them presentation ownership.

### Valid presentation recovery

- [x] Select and document a bounded canonical presentation mechanism: a
  server-maintained terminal emulator/checkpoint or an equivalent validated
  state snapshot tied to an exact raw-output position.
- [x] Hydrate a fresh client from a valid checkpoint and deliver subsequent raw
  output exactly once with no snapshot/live handoff gap.
- [x] Never start replay at an arbitrary byte suffix. If no valid checkpoint is
  retained, return an explicit resync/unavailable presentation state.
- [x] Bound checkpoint memory, serialization size, generation work, frequency,
  and per-client hydration queues. Treat PTY output as untrusted throughout.
- [x] Remove or reconcile the stale 64-KiB migration assertion with the chosen
  presentation contract instead of merely changing it to the current 32-KiB
  value.

These items were formerly backed by a whole-transcript replay surrogate, which
failed once output exceeded the 32-KiB command-header budget. They are now
implemented and verified through the binary checkpoint design in
[Task 35](./35-durable-terminal-presentation-recovery.md).

### Verification

- [x] Add PTY fixtures that query colours, device attributes, status/cursor,
  window state, focus, and mouse modes with two xterm clients attached; assert
  only one response reaches the PTY for each query.
- [x] Test lease acquire, renewal, explicit takeover, concurrent takeover,
  disconnect, expiry, revocation, reconnect, and unauthorized input.
- [x] Test checkpoints at every byte boundary around CSI, OSC, DCS, UTF-8,
  alternate-screen, bracketed-paste, cursor/style, and synchronized-output
  sequences.
- [x] Add Docker-isolated Electron/browser E2E proving both displays remain
  identical during shell and TUI activity, read-only input is rejected, takeover
  works, and no control-sequence garbage reaches the shell. Run it only through
  `npm run test:e2e`.

## Acceptance checks

- Desktop and browser render the same live PTY output and exit state.
- Exactly one attached emulator can send keyboard, paste, resize, or automatic
  terminal replies at a time; another authorized client can take over through
  an explicit visible action.
- Attaching an observer never changes PTY dimensions or injects bytes.
- Querying terminal capabilities with multiple clients produces one valid
  response and no printable OSC/CSI garbage at the shell prompt.
- New, reconnected, and post-gap clients start from a valid presentation state
  and then receive every later output byte once.
- Lease and checkpoint enforcement is server-authoritative and cannot be
  widened by client-provided focus, title, project, or session metadata.

## Definition of done

Interactive presentation ownership and bounded valid-state hydration are part
of the terminal protocol, focused hostile/control-sequence tests pass, and the
real two-client Electron/browser terminal scenario passes through
`npm run test:e2e` without duplicated input, invisible output, or corrupted
screen state.
