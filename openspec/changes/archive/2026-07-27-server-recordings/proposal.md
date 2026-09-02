## Why

Recording lived in privileged Electron code and was tied to renderer lifetime, so
a reload, a disconnected client, or a moved view could interrupt or duplicate a
capture, and replay required the client to hold filesystem paths. A remote user
could not manage or replay a recording at all.

## What Changes

- Move capture start/stop, default policy, output and optional input capture,
  resize events, metadata updates, finalization, and error state into
  server-core, so capture happens exactly once at the server PTY boundary.
- Make capture independent of clients: it continues with no observers, and
  observers become replaceable subscriptions that each receive the same
  lifecycle snapshots without duplicating cast events.
- Add bounded, authorized `recordings.list`, `recordings.replay`,
  `recordings.start`, `recordings.stop`, `recordings.delete`, and
  `recordings.reveal` operations on a transport-neutral server adapter.
- Add interrupted, missing, malformed, and failed recovery states, and finalize
  accurately on PTY exit, explicit stop or close, server shutdown, writer
  failure, and restart recovery.
- Register supported legacy recording roots by metadata-only opaque reference
  without moving user data.
- Remove persisted cast paths from the recording list DTO before local or remote
  transport, so no client receives a filesystem path.
- **BREAKING** Reveal is available only where a capable host represents the
  server machine; elsewhere clients receive path and copy guidance instead.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `recording`: recording lifecycle, storage, timeline, replay, and deletion
  become server-owned, with clients as replaceable management and replay
  surfaces.

## Impact

`packages/server-core` recording service and protocol adapter, the shared
`RecordingsClient` facade, the recordings timeline UI, the Desktop reveal
capability, and the application protocol's recording operations. Existing
asciicast v3 files and their adjacent metadata remain readable.
