## Why

Each attached xterm forwarded its entire `onData` stream to the shared PTY. `onData` carries
both deliberate keyboard and paste input and automatic replies to terminal queries, so two
attached emulators answered one PTY query twice and the duplicate reply could be consumed or
echoed as ordinary input. Resize already had an ownership lease, but interactive input and
emulator-generated responses did not. Separately, initial replay could start at an arbitrary
byte offset inside retained ANSI/OSC output, which is not enough to reconstruct a fresh
emulator's screen and modes.

## What Changes

- Add a server-owned interactive presentation lease covering the complete `onData` stream and
  viewport changes, with bounded expiry, renewal, release, disconnect cleanup, revocation, and
  an observable revision.
- Require explicit user intent to acquire or take over control; present controller and read-only
  state with an accessible takeover action in wide and narrow clients.
- Keep macro, dictation, and MCP writes on their separately authorized ordered server input
  paths without granting them presentation ownership.
- Replace arbitrary byte-suffix replay with hydration from a bounded validated presentation
  checkpoint tied to an exact raw-output position, with an explicit resync/unavailable state
  when no valid checkpoint is retained.
- Remove the stale 64-KiB migration assertion rather than merely restating it as the current
  32-KiB value.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminal-workspace`: adds the interactive presentation lease, takeover presentation, and
  checkpoint-based attach boundary.
- `terminal-stream-congestion-and-recovery`: adds contiguous checkpoint-to-live transition and
  the explicit unavailable presentation state.

## Impact

Terminal protocol attach and input commands, the server-side presentation checkpoint, xterm
attachment in the workspace renderer, and the two-client Docker Electron/browser E2E suite.
