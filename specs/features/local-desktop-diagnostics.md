# Local Desktop diagnostics

## Summary

Terminay Desktop continuously records a bounded, local diagnostic history so a
packaged application can be investigated without launching it from a terminal
or leaving developer tools open. Diagnostics distinguish application startup
and shutdown, main-process failures, renderer white screens and crashes,
renderer hangs, Electron child-process failures, and embedded Local server
failures.

The default history covers the preceding 24 hours. It is never uploaded
automatically. Readable logs and crash annotations exclude terminal content,
credentials, project content, and other user data that is not necessary to
identify the failing component and lifecycle transition. Native crash dumps
remain sensitive opaque artifacts because they can contain fragments of
process memory.

## Scope and ownership

Terminay Desktop main owns diagnostic collection, storage, retention, and
reveal/clear actions. Filesystem writes and Electron process inspection never
move into a renderer or the server-bundled workspace UI.

Each Desktop renderer is an untrusted diagnostic source. Main observes bounded
Electron lifecycle and console events for a known `WebContents`; a renderer
does not receive a general-purpose logging IPC method, file path, file handle,
or permission to read existing diagnostics.

Desktop records bounded lifecycle failures from its in-process embedded Local
Terminay Server composition. Its application logging follows the bounded main
process output route; it does not create a fictitious child stdout/stderr
boundary. If the embedded server moves behind a real supervised process later,
only that process's application output and lifecycle become additional sources.
Neither architecture captures PTY streams or shell-process output. Diagnostics
for a standalone or remote Terminay Server remain owned by that server host;
connecting to it does not copy its service logs into Desktop.

## Diagnostic artifacts

Desktop uses Electron's platform log directory. The default macOS location is:

```text
~/Library/Logs/Terminay
```

Linux and Windows use Electron's platform-appropriate application log
directory. Product behaviour and UI refer to this location as the
**Diagnostics folder** rather than promising one literal path on every
platform.

The folder contains:

- timestamped, line-oriented application log segments for the current and
  recent launches;
- local native crash dumps collected by Electron Crashpad; and
- a small launch marker used to distinguish a clean exit from an interrupted
  session.

Application logs use UTF-8 JSON Lines. Every complete line is independently
readable and parseable and contains a schema version, UTC timestamp, severity,
component, stable event name, launch id, and bounded event fields. A formatted
message and stack may be included when safe. Multiline and control characters
are escaped so renderer output cannot forge additional entries.

Launch ids are random correlation values and do not grant authority. A new
launch records the Terminay, Electron, Chromium, Node, operating-system, and
architecture versions plus whether the previous launch ended cleanly. It does
not record usernames, device names, environment variables, command-line
secrets, project roots, or connection credentials.

Native crash dumps are diagnostic binaries, not a substitute for the readable
application log. Crash reporting starts before any renderer is created, stores
dumps locally, and has upload disabled.

## Always-on coverage

The normal diagnostic level records:

- Desktop main startup milestones, readiness, window creation/destruction, and
  clean shutdown;
- main-process warnings, uncaught exceptions, unhandled rejections, stdout,
  and stderr that originate from Terminay application code;
- renderer information, warnings, errors, uncaught errors, unhandled
  rejections, preload failures, failed loads, and failed navigations;
- user-visible Git operation failures that are caught and rendered as ordinary
  UI state, using a stable operation label and sanitized bounded error text;
- unexpected renderer exit with Electron's reason and exit code, including
  crash, out-of-memory, killed, launch-failed, integrity-failure, and memory
  eviction outcomes;
- unexpected GPU, network-service, audio-service, and other Electron child
  process exits with their bounded type, service name, reason, and exit code;
- renderer `unresponsive` and later `responsive` transitions;
- bounded process memory and CPU metrics when a process becomes unresponsive
  or unexpectedly exits;
- embedded Local server composition construction, readiness, deliberate
  shutdown, and startup/runtime/shutdown failure; and
- diagnostic-writer, cleanup, crash-dump, and retention failures.

Normal user actions and high-frequency UI state do not produce one event per
interaction. A caught successful-path error is recorded only when it becomes a
user-visible operational failure; the event excludes repository and worktree
paths, refs, command arguments, and raw Git output. Debug-level tracing, raw Chromium verbose logging, Chromium
network logs, protocol frame dumps, request/response bodies, and screenshots
are not enabled by the always-on collector.

Intercepting or observing logging must preserve development console output and
must not install an exception handler that turns a fatal main-process error
into continued execution in a potentially corrupt state.

## White-screen evidence

A renderer that fails before or during bootstrap records the load URL class
without its path, query, fragment, credentials, or remote host; load phase;
Electron error code; a bounded safe description; and the associated
`WebContents` diagnostic id.

Preload failures and renderer exceptions include a bounded stack after source
locations have been reduced to packaged application-relative module names.
The shared application root has an error boundary that emits one bounded
failure event and presents its normal recovery UI. Repeated rendering of the
same failure is deduplicated.

Desktop does not claim to detect a visually blank page when Chromium remains
responsive and no load, preload, console, or application error occurs. It does
not capture an automatic screenshot because the window can contain terminals,
files, secrets, or other private content.

## Hang evidence

When Electron reports a renderer as unresponsive, Desktop immediately records
the transition and bounded process metrics. Where the pinned Electron version
supports it, Desktop also requests the main frame's currently running
JavaScript call stack using Electron's unresponsive-renderer stack collection.
Collection is time-bounded and asynchronous: an unavailable or never-resolving
stack records a bounded outcome and cannot delay the main process, shutdown,
or recovery.

A matching `responsive` event records the observed duration. Repeated
unresponsive notifications for the same episode are coalesced.

An application cannot reliably diagnose its own main process while that
process is deadlocked. The readable log can show the last completed operation,
but automatic operating-system sampling and an out-of-process watchdog are not
part of the always-on feature.

## Bounds, rotation, and retention

- Application logs rotate at one hour or 10 MiB, whichever happens first.
- One normalized event is at most 16 KiB. Oversized messages, stacks, arrays,
  and objects are truncated with an explicit marker rather than rejected or
  written without a bound.
- Every main, renderer, child-process, and embedded-server text source is
  limited to 100 entries and 256 KiB of encoded text per rolling 10-second
  window, whichever is reached first. Suppressed bursts produce one summary
  with a count rather than consuming unbounded memory, IPC, main-process time,
  or disk. Low-volume lifecycle events use an independent bounded channel so a
  console flood cannot hide the later process-exit event.
- Closed artifacts expire 24 hours after their creation. Cleanup runs before
  normal startup, after a segment closes, after resume from system sleep, and
  periodically while Desktop remains open.
- A 100 MiB aggregate cap applies to closed application segments and crash
  artifacts even when they are younger than 24 hours. Oldest closed artifacts
  are removed first.
- The active segment is never removed underneath its writer. Rotation occurs
  before enforcing the aggregate cap when possible.
- Cleanup operates only on recognized diagnostic artifacts beneath the
  canonical Diagnostics folder, never follows symbolic links, and treats an
  unfamiliar file as user-owned.
- A deletion, permission, disk-full, or serialization failure does not crash
  Terminay or prevent a terminal from running. The collector falls back to a
  bounded stderr warning when possible and retries only at a bounded cadence.

Retention is based on artifact creation recorded by Terminay, not a
renderer-supplied timestamp. System suspension can delay physical deletion;
cleanup runs before further normal collection after resume. No closed artifact
is deliberately preserved as a special “last crash” exception after it
expires.

## Access and lifecycle controls

The Desktop Help menu provides **Reveal Diagnostics Folder**. The action opens
the platform file manager at the canonical directory and remains available
when no workspace or server connection is healthy.

The same menu provides **Clear Diagnostics…** with confirmation. Clearing
removes closed managed logs and crash artifacts, rotates the current
application log, and records only that a clear occurred; it does not delete an
unrecognized file or require a renderer filesystem capability.

Diagnostics are readable after a crash by opening the folder directly or by
relaunching Terminay and using the Help menu. Terminay does not require a
support account, network connection, or developer mode to access them.

## Security and privacy

Diagnostic artifacts are treated as sensitive local data. Their directory and
files use user-only permissions where the platform supports them. Terminay
never uploads, syncs, attaches, or exposes them to another client or server
without a separate future user-authorized feature.

Crash annotations follow the same exclusions as readable logs. A Crashpad
minidump can nevertheless include fragments of native process memory, so the
product treats it as potentially containing terminal, file, or secret data,
keeps it under the same local retention and permission controls, and never
claims that its contents have been redacted.

Normal and failure logging excludes:

- PTY output, typed or pasted input, terminal scrollback, recordings, and
  terminal titles derived from commands;
- file contents, diffs, clipboard contents, dictation audio/transcripts, and
  screenshots;
- project roots, current working directories, user-selected filenames, home
  directory, usernames, hostnames, and environment-variable values;
- pairing links, URL query strings/fragments, PINs, reconnect grants, cookies,
  authorization headers, API keys, vault values, and secret-bearing provider
  errors; and
- raw application-protocol, WebRTC, MCP, Git, or network payloads.

Known errors are logged as stable event names and bounded error categories.
Arbitrary renderer, child-process, and provider text is untrusted: it is
length-bounded, control-character escaped, and passed through the common secret
and path sanitizer before persistence. Sanitization is defence in depth;
callers remain responsible for emitting metadata rather than user content.

Opaque process-local diagnostic ids may correlate a window, `WebContents`,
connection, or terminal lifecycle within one launch. Durable credentials and
raw authority-bearing ids are not diagnostic correlation keys.

## Non-goals

- No automatic telemetry, crash upload, hosted log aggregation, or support
  bundle submission.
- No recording of terminal sessions or user interaction for reproduction.
- No always-on Chromium network log, packet capture, protocol trace, screenshot,
  heap snapshot, CPU profile, or verbose Chromium log.
- No promise that a native crash dump is directly human-readable.
- No automatic restart or silent renderer reload as a consequence of
  collecting an error.
- No claim that self-observation can identify a main-process deadlock after the
  main event loop stops.
- No standalone-server service-manager logging policy; see
  [Standalone server operations](../operations/standalone-server.md) for that
  deployment boundary.

## Acceptance outcomes

- A packaged Desktop launch with no visible terminal creates a readable
  versioned application log in the platform Diagnostics folder and marks a
  clean exit.
- Main and renderer test exceptions appear once with useful application frames,
  while the existing fatal/recovery behaviour remains unchanged.
- Renderer load failure, preload failure, crash, out-of-memory termination,
  and GPU child failure each produce a distinct stable event with the Electron
  reason and exit code where available.
- A deliberately blocked renderer produces one unresponsive episode, a
  time-bounded stack-collection outcome and process metrics, followed by its
  duration when it recovers.
- An embedded Local server failure records its bounded semantic lifecycle and
  application error metadata without recording any PTY output.
- Console flooding and an oversized cyclic object cannot freeze Desktop,
  allocate unbounded memory, forge log lines, or exceed per-event and rotation
  bounds.
- Fixtures containing terminal text, paths, URL credentials/fragments,
  authorization values, pairing material, API keys, and provider secrets do
  not persist those values in logs or crash annotations.
- Cleanup removes expired managed segments and crash artifacts, enforces the
  aggregate bound, preserves the active segment and unfamiliar files, and
  cannot traverse a symlink outside the Diagnostics folder.
- **Reveal Diagnostics Folder** and confirmed clearing work without a healthy
  renderer workspace or Local server.
- No diagnostic artifact is transmitted during remote connection, pairing,
  update checks, or ordinary application use.

## Related features

- [Connections and client hosts](./connections-and-client-hosts.md)
- [Recording](./recording.md)
- [Remote access](./remote-access.md)
- [Server runtime and application protocol](./server-runtime-and-protocol.md)
- [Settings, shortcuts, and desktop integration](./settings-shortcuts-and-desktop-integration.md)
