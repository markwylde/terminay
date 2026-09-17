## Why

On 2026-09-17 Terminay quit with a macOS "quit unexpectedly" dialog while the
Grok agent extension was publishing a burst of lifecycle events. The recorded
fatal event was `main.uncaught-exception` with `write EPIPE`, raised from the
extension host's `handleAgentLifecyclePublication`. The extension child process
exists so that an extension failing cannot take anything else down, and here
one took down the whole application.

Three defects lined up:

- The host listened for its child's `error` event with `once`. A
  `ChildProcess` emits `error` for every write the operating system refuses,
  so the first EPIPE used the listener up and the next had none. In Desktop
  main an uncaught exception aborts the process.
- Both sides treated `send()` returning `false` as a lost frame. Node returns
  `false` when the channel's write queue is long; the frame is still queued
  and delivered. Earlier the same morning the Grok child exited with `agent
  IPC send failed` for exactly this reason, and the host logged 294
  `channel-closed` records for a child that was alive.
- The diagnostic sanitizer reduced `file://` URLs to `<url:redacted>`. An ES
  module names itself in a stack by file URL, so every frame of the fatal
  stack, and of the extension's own report, was unreadable.

An audit of the same shape in Desktop main found helper-process stdin writes
with no `error` listener, where a CLI exiting before reading its prompt would
end the application the same way, and two fire-and-forget promises whose
rejection would.

## What Changes

- The extension host keeps a persistent `error` listener on each child, and
  after it detaches listeners to terminate one. Writes to the child pass a
  callback, so a refused write is reported there instead of as an event.
- A `false` return from `send()` is treated as a queued frame on both sides.
- The child names why a frame was refused (unserializable, over the size
  limit, no connected channel, rejected by `process.send`) in the error it
  reports, and reports a fatal error before exiting when a reply it owes the
  host cannot be written, where it used to exit with code 73 and nothing else.
- New extension host diagnostic transitions `channel-write-failed` (first
  refusal per child, with its system error code) and `child-error`; the
  `child-exited` record carries refused-write, pending-call, and in-flight
  publication counts. An unrequested child exit is recorded as a warning.
- The sanitizer keeps a `file:` URL's path and drops its query and fragment.
- Desktop main listens for `error` on the stdin of the AI provider CLI, the
  tab-metadata CLIs, and the Parakeet worker; the Parakeet worker is no
  longer written to after it has been stopped; the file watcher and the
  remote connection-closed audit write catch and log their rejections.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `extension-platform`: "Crash containment" states that an extension's
  failure, including the errors its host observes while writing to it or
  terminating it, never ends the process that hosts it. A new requirement
  states that a long write queue is not a lost frame.
- `local-desktop-diagnostics`: "Extension host lifecycle is recorded" adds
  refused writes and child errors; "Untrusted text sanitization and
  correlation ids" keeps `file:` URL paths.

## Impact

- `packages/server-core/src/extensions/host.ts`, `child.ts`, `diagnostics.ts`,
  `node-shims.d.ts`
- `packages/server-core/src/aiService/cliProvider.ts`, `parakeetRuntime.ts`
- `electron/main.ts`, `electron/diagnostics/core.ts`,
  `electron/aiTabMetadata/service.ts`, `electron/fileViewer/fileWatchService.ts`,
  `electron/remote/service.ts`
- Tests: `packages/server-core/test/extension-host-channel-loss.test.mjs`,
  `scripts/local-desktop-diagnostics-core.test.mjs`
- No protocol, renderer, or privileged surface changes. Desktop main still
  aborts on an uncaught exception; this change removes the paths by which an
  extension or helper process could cause one.
