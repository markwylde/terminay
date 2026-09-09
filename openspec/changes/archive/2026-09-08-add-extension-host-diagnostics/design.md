## Context

Extension hosts are the only major server subsystem with no diagnostic route. `local-server.*` events already cover pairing, WebRTC, congestion, file operations, and server lifecycle, and they reach the log through composition callbacks that `electron/main.ts` forwards to `DesktopDiagnostics.record`. The extension layer has nothing equivalent, so a host that dies takes its cause with it.

Three gaps compound into the observed failure:

1. `packages/server-core/src/extensions/child.ts:56-57` installs `uncaughtException`/`unhandledRejection` handlers that call `process.exit(70)`/`(71)`. Registering those handlers suppresses Node's own stack print, so the child dies producing no output at all.
2. `ExtensionHost.recordFailure` (`host.ts:1291`) computes `restartAt` and stores it on the state object. The only reader is the guard in `start()` (`host.ts:209`). No timer, poller, or listener ever acts on it, and `activateEnabled()` runs once from `initialize()` at server start (`extensions/composition.ts:150`, `composition.ts:819`).
3. `ExtensionAgentRuntimeRegistry` accepts an `onAdmissionFailure` hook (`activity/extensionAgentRuntime.ts:56`) that the production composition never supplies.

After five failures in the 60-second crash window (`DEFAULTS.maxCrashesInWindow`) the host is quarantined. `clearQuarantine()` has no caller in the repository, so quarantine survives every Settings action and ends only with the application process.

Boundaries this design touches: **Server → extension child** (ADR-0011: namespaced bounded IPC, crash isolation, extension code is trusted-but-fallible) and **vault/migration/logging → operators** (ADR-0011: only metadata crosses transport; secret bytes are never logged). Server Core must not import Electron, so every new record leaves server-core through an injected callback, exactly as delivery and pairing diagnostics already do.

## Goals / Non-Goals

**Goals:**

- A crashed extension leaves enough evidence in the Diagnostics folder to identify the failing code on the first crash.
- An extension host that dies during a session comes back on its own.
- Quarantine is visible and clearable without restarting the application.
- Agent observation outcomes — matched, admitted, bound, failed, released — are recordable per terminal.

**Non-Goals:**

- Fixing whatever the Claude Code provider actually throws. That is the next change, once the logging names it.
- A general-purpose logging API for extension code. Extensions get no diagnostics channel of their own; the host records what it observes.
- Changing the crash-window or backoff constants, or introducing a user-facing setting for them.
- Any renderer, protocol, or PTY surface change.

## Decisions

### The child reports its fatal error over the existing IPC channel, not stderr

A new `fatal` host frame carries `{ name, message, stack, exitCode }` and is sent synchronously before `process.exit`. Alternatives considered: writing to stderr, and removing the handlers so Node prints the default trace. Both were rejected because the child is an Electron utility process in a packaged app — its stderr has no terminal and is not captured by the diagnostics writer, which is the exact reason this failure was invisible. The IPC channel is already the child's only sanctioned egress and is bounded by `maxMessageBytes`.

The frame is best-effort: `process.send` can fail on a disconnected channel, and a `SIGKILL`ed child never sends anything. The host therefore always records the observed exit code or signal independently, and treats the frame as enrichment.

### Error text is recorded verbatim, and path redaction is dropped

The recorded `name`, `message`, and `stack` are not truncated, redacted, or path-stripped. Alternatives considered: message-only, and rewriting `$HOME` to `~`. Both were rejected as costing debuggability on the first crash for no real gain.

This is not free: `sanitizeDiagnosticText` currently rewrites every absolute path in every string it records to `<path:redacted>`, which swallows the file name in a stack frame (`at renamedSessions (<path:redacted>:312:19)`) and is asserted by an existing test. Three ways out were weighed — leave it and accept unreadable stacks; exempt only the error fields; or drop path redaction from the sanitizer entirely. **The third was chosen deliberately**, so one sanitizer governs all recorded text rather than one rule for error fields and another for everything else.

The consequence is stated plainly: recorded diagnostics on this machine can now contain absolute paths — project roots, worktree names, and the user's home directory — wherever they appear inside error text from any source, not only extensions. What the sanitizer still removes is what actually authorises or discloses: URLs (with their credentials, queries and fragments), bearer and API keys, GitHub tokens, private key blocks, and secret-shaped fields. Terminal output, journal records, prompts, and tool inputs and results remain excluded at the callers, which is where they were always excluded.

That is defensible only because of where these files live: the Diagnostics folder is local, user-only permissioned, never uploaded or synced automatically, and sharing it is a deliberate user action. It crosses the logging row of ADR-0011 ("only metadata crosses transport; secret bytes are never logged") on the metadata half, not the secret half — so the boundary holds, but the spec deltas say so explicitly rather than leaving it implied.

Control-character escaping and length bounding are untouched, so a stack containing newlines still cannot forge extra log lines — the JSON Lines integrity rule is unchanged.

### Diagnostics leave server-core through injected callbacks

Two new optional composition callbacks — one for extension host lifecycle, one for agent observation — follow the shape of `onDeliveryDiagnostic` and `onFileOperationFailure`. `electron/main.ts` maps them onto new `local-server.extension.*` and `local-server.agent.*` names added to `DIAGNOSTIC_EVENT_NAMES`, on the `lifecycle` rate channel. Alternative considered: extending the in-process `streamDiagnostics` ring. Rejected because that ring is terminal-stream-scoped, rolls over at 512 records, and is not wired to the log file. A callback left undefined is a silent no-op, so a standalone server host stays free to route these records to its own sink.

### Restart supervision lives in the extension composition, not in ExtensionHost

`ExtensionHost` keeps owning failure classification and backoff arithmetic; it gains a state-change listener rather than a timer. The supervisor sits beside `activate` in `extensions/composition.ts`, where the existing `activate(extensionId)` already performs stop, start, and contribution re-publication. Re-publication matters more than the restart itself: publishing contributions triggers `reobserveExistingTerminals`, which is what lets an already-running `claude` bind without the user touching the terminal.

Alternatives considered: a timer inside `ExtensionHost` (would put process scheduling in the class that must stay unit-testable with an injected clock, and it cannot re-publish contributions), and polling `statuses()` from the manager (wasteful and adds a latency floor). The supervisor takes injected `schedule`/`cancel` functions for the same testability reason the runtime registry does.

### Quarantine is cleared by an explicit restart, never automatically

The supervisor stops at quarantine — that threshold exists precisely to stop a crash loop, and automatic clearing would defeat it. The Settings **Restart** action instead becomes a deliberate reset: stop the host if running, `clearQuarantine()`, then activate. This makes the existing button do what its label already promises, and keeps the automatic path incapable of looping forever.

## Risks / Trade-offs

- **A crash loop now writes records instead of failing silently** → The `lifecycle` rate channel already caps per-source volume and emits a suppression summary; the supervisor also stops at quarantine, bounding the loop to five restarts per window.
- **Dropping path redaction widens what every diagnostic source can record, not just extensions** → Accepted deliberately. Renderer console text, server errors, and Git/file failure records can now contain absolute paths too. The callers for those paths already emit metadata rather than user content, and the requirements that forbid recording project roots and working directories as fields of their own are unchanged; only paths carried inside error text are retained. Secret, token, private-key, and URL redaction are untouched.
- **Automatic restart could mask a bug that used to be obvious as a missing sidebar row** → Every restart is recorded with its consecutive-failure count, so a host restarting repeatedly is louder in the log than a host that quietly stayed dead, not quieter.
- **A restarted agent host re-admits terminals and could duplicate entries** → Admission goes through the existing claim/incarnation path, which already releases the prior claim and mints a new context id; the observed failure mode is a *missing* entry, and the re-observe path is exercised today by extension enable/disable.
- **The fatal frame arrives after the host has already seen `exit`** → The host correlates by extension id and merges the reported error into the failure record it is already writing; if the frame never arrives, the record still carries the exit code.

## Migration Plan

No data migration. New diagnostic event names are additive to an allowlist, and old log segments remain readable. Rollback is reverting the change: the supervisor and the callbacks are additive, and an unwired callback is a no-op.

## Open Questions

None. No in-force ADR needs revisiting: this design operates inside ADR-0011's existing extension-child and logging boundaries rather than changing either.
