# Terminal recording

## Summary

Terminay supports optional per-terminal session recording and a timeline for
replaying saved sessions. Recording is off by default and can be enabled for
new terminals or started and stopped for one terminal.

Recordings live on the selected Terminay Server. Capture continues independently
of client focus, renderer lifetime, or network connection and never passes
through the hosted signaling service.
Recording observers are replaceable subscriptions: disconnecting, reloading, or
moving a view removes only that observer. Multiple observers receive the same
server lifecycle snapshots, while each PTY boundary event is appended exactly
once.

Capture occurs at the Terminay Server's routed terminal-stream boundary, so a
remote environment can be recorded without writing on the target. Environment
identity is retained as non-secret provenance; cwd/root may be remote path text,
while reveal/delete always act on the server recording store.

## Ownership

Terminay Server owns:

- recording policy and storage configuration;
- capture of PTY output, authorized input, resize, and lifecycle events;
- asciicast and metadata persistence;
- recording state, listing, replay reads, and deletion; and
- path validation, retention, and recovery.

Clients display recording state, request explicit actions, and render replay
data through bounded application-protocol transfers. A client does not need
direct filesystem access to use recordings.

The shared client facade uses the canonical `recordings.*` operations for every
host, validates bounded list/replay/state DTOs, caches list queries until an
explicit recording mutation (including an uncertain reconnect outcome), and
removes project roots and cast paths before data reaches shared UI code.
The timeline uses that facade for list, bounded replay, reveal, and deletion on
every host. Desktop supplies only the negotiated native reveal presentation;
it does not implement or translate recording operations.

## Defaults and controls

- Recording is disabled by default.
- **Record new terminals** enables automatic capture for terminals created
  after the setting changes.
- Existing terminals do not begin recording merely because the global default
  changes.
- A terminal tab menu provides **Start Recording** or **Stop Recording** for
  that exact session.
- The recording indicator is visible without relying only on colour and has an
  accessible label.
- Starting an already active recording and stopping an inactive recording are
  idempotent.
- The Recordings command opens the recordings timeline in a Desktop auxiliary
  window or an in-page web route.

## Format

Each session consists of:

- one asciicast v3 `.cast` file containing the terminal event stream; and
- one adjacent metadata JSON file containing Terminay-specific index data.

The cast header includes version, initial terminal dimensions, start timestamp,
and optional environment metadata limited to safe display values such as
`TERM` and `SHELL`. Events record time relative to the start:

- `o` for PTY output;
- `i` for input when input recording is enabled;
- `r` for terminal resize; and
- `m` for bounded Terminay markers needed by replay.

The writer emits complete newline-delimited JSON records, serializes concurrent
writes, and never leaves a partially interleaved event. Timestamps are
monotonic within one recording.

## Input privacy

Input recording is a separate setting and defaults to disabled. When disabled,
typed input is not written as `i` events.

The UI explains that enabled input recording can capture passwords, tokens, and
other secrets. Terminay does not claim to detect secret prompts reliably.
Paste, macros, dictation insertion, MCP writes, and remote writes follow the
same input-recording policy as keyboard input.

Disabling input capture affects later events; it does not rewrite an existing
recording.

## Storage

The default recording root is:

```text
~/Documents/TerminaySessions
```

Sessions are grouped under date directories and use opaque ids in filenames.
User-facing titles are metadata, not path components.

The server:

- expands and canonicalizes the configured root;
- creates missing directories with user-only permissions where supported;
- prevents traversal outside the configured root for list, replay, delete, and
  reveal operations;
- writes metadata atomically;
- keeps incomplete recordings discoverable and labels their state accurately;
- preserves configured historical roots in the library index while a volume,
  network mount, or removable device is temporarily unavailable;
- recovers a cast created before its metadata sidecar as the same opaque
  recording id with an `interrupted` state; and
- never overwrites a different recording after a title or project rename.

Changing the recording root affects new recordings. Existing entries remain
visible through their recorded roots until removed from the configured library
or deleted explicitly.

## Metadata

Metadata contains:

- stable recording id and terminal session id;
- server id and project id;
- project name and root snapshot;
- terminal title, note, colour, and emoji snapshot where available;
- cwd snapshot;
- start and end timestamps;
- duration;
- initial and final dimensions;
- process exit code or signal when available;
- `recording`, `completed`, `interrupted`, or `failed` state;
- whether input events are present;
- format/version information; and
- relative cast path plus bounded size information.

Metadata updates when user-facing terminal information changes during capture.
An absent optional field remains absent rather than being guessed.

## Capture lifecycle

- Automatic capture starts at the privileged PTY creation boundary before the
  shell can produce its first output event.
- The first known dimensions are written to the header; a later fit emits an
  `r` event.
- Output is recorded once at the server PTY boundary, before fan-out to
  clients.
- Authorized writes are recorded once at the server input boundary when input
  capture is enabled.
- Terminal exit finalizes the recording exactly once.
- Explicit terminal close, server shutdown, recording stop, and fatal writer
  error all finalize with an accurate state. A fatal writer error closes and
  removes the active writer while retaining its visible failed state.
- Client disconnect, reload, window close, or view movement does not finalize
  an active recording.
- A server restart marks an unfinalized recording interrupted and preserves its
  valid events.

Recording failure does not interrupt the PTY. The server publishes a visible
error and stops claiming the session is being captured.

## Timeline

The timeline lists recordings newest first and supports:

- search by title, project, cwd, and date;
- date and project grouping;
- recording-state and input-present filters;
- duration, exit status, and file-size display;
- replay;
- reveal on the server host where the client has that capability; and
- confirmed deletion of the cast and metadata files.

Missing or malformed metadata does not crash the timeline. A valid cast can be
shown with reduced metadata; missing cast data is shown as unavailable.

Deleting a recording is explicit and cannot escape the configured recording
roots. It does not close or alter a live terminal. Deleting an actively written
recording requires stopping it first or confirming a combined stop-and-delete
action.

## Replay

Replay is read-only and uses xterm-compatible rendering. It supports:

- play, pause, restart, seek, and playback speed;
- recorded resize events;
- a visible timestamp and total duration;
- safe handling of truncated final lines; and
- bounded incremental loading for large recordings.

Replay never executes recorded input, links, commands, or escape-sequence side
effects outside terminal rendering. External links remain guarded by the normal
terminal policy.

## Security and privacy

- Recording remains opt-in and input capture requires separate consent.
- Cast and metadata paths are server-authorized by opaque recording id.
- Remote clients receive only recordings within their authorized server scope.
- Recording data is not uploaded to Terminay-hosted infrastructure.
- Logs exclude terminal content and recorded input.
- Recording lifecycle notifications are metadata-only; configured roots,
  absolute cast paths, environment secrets, and recorded input are not copied
  into observer payloads or normal diagnostics.
- Secret values from settings or macros are not added to metadata.
- A recording is treated as sensitive terminal history in warnings, export,
  deletion, and support diagnostics.

## Non-goals

- No cloud sync or automatic upload to asciinema.org.
- No video export.
- No promise to redact secrets from output or enabled input capture.
- No replay that restores a live process.
- No requirement for a database-backed timeline.

## Acceptance outcomes

- A terminal records valid asciicast v3 output and metadata when capture is
  enabled.
- Input is absent by default and present only after explicit input-capture
  consent.
- Recording survives client reload, disconnect, and native-window closure while
  the server and PTY remain alive.
- Terminal exit and server shutdown produce one finalized or interrupted
  recording rather than corrupting the cast.
- A remote authorized client can list and replay the server's recordings
  without direct filesystem access.
- Traversal, cross-server ids, stale delete requests, and unauthorized replay
  requests are rejected.
