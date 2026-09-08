## Why

A user running three Claude Code sessions saw only one of them in the Agents sidebar, and the one shown had been frozen for 23 hours. The cause was that the `com.terminay.agent.claude-code` extension host had died: every other extension host was still running, agent binding for that provider was dead for the whole 24-hour life of the app, and the Settings panel eventually showed the extension as **Quarantined**. Nothing in `~/Library/Logs/Terminay` recorded any of it — across 24 log rotations there is not one line with an `extension` component, no host start/stop/crash, and no agent admission event. The extension child kills itself with `process.exit(70)`/`(71)` on an uncaught exception or unhandled rejection without printing anything, `ExtensionAgentAdmissionFailure.onAdmissionFailure` exists but nothing wires it to the diagnostics sink, and once a host fails nothing ever restarts it: `recordFailure` stores a `restartAt` backoff that no code path consumes, and `activateEnabled()` runs only at server start. After five failures in a minute the extension is quarantined, and `clearQuarantine()` has no caller anywhere, so even the Settings **Restart** button cannot bring it back.

The user-visible result: agents silently stop appearing in the sidebar, there is no message explaining why, and the only recovery is restarting the whole application — with no evidence left behind to diagnose the original fault.

## What Changes

- The extension child reports its fatal error to the host before exiting. `uncaughtException` and `unhandledRejection` handlers send a bounded final frame carrying the error name, message, and stack, and the exit code, instead of exiting silently.
- The extension host records bounded diagnostics for host lifecycle: child spawn, ready, child exit (code/signal), failure with the child-reported error, backoff scheduling, quarantine, and quarantine clearing.
- Agent admission diagnostics are wired up. The existing `onAdmissionFailure` hook is connected to the privileged host's diagnostics sink, and successful admission, binding, and release are recorded too, so a terminal that never binds is distinguishable from one that binds and dies.
- Extension error detail is recorded verbatim. Because diagnostics are local-only and never uploaded, and extensions are trusted Node programs, the recorded error name, message, and stack are not redacted or path-stripped. Terminal output, journal records, prompts, and credentials remain excluded.
- The diagnostics sanitizer stops redacting filesystem paths. A stack whose file names are replaced by `<path:redacted>` cannot be read back to the code that threw. URL, credential, token, and private-key redaction are unchanged, and this applies to every diagnostic source rather than only to extension errors.
- A failed extension host is restarted automatically. A supervisor honours the `restartAt` backoff that `recordFailure` already computes, restarts the host when the backoff expires, and stops at the existing quarantine threshold.
- Quarantine becomes recoverable and visible. An explicit **Restart** from Settings clears quarantine and starts a fresh crash window, so recovery no longer requires restarting the application.

## Capabilities

### New Capabilities

_None. This change extends existing capabilities._

### Modified Capabilities

- `local-desktop-diagnostics`: adds extension-host lifecycle and agent-observation event families to the recorded diagnostic history, states that a trusted extension's error name, message, and stack are recorded verbatim in the local, never-uploaded log, and changes the common sanitizer to retain filesystem paths while still reducing URLs and secret-shaped values.
- `extension-platform`: adds a supervised restart requirement for a failed host, requires the child to report its fatal error before exiting, and makes quarantine both recorded and clearable through an explicit restart.
- `agent-status-and-sidebar`: the `agent-admission-failed` diagnostic must actually be emitted, and may carry the provider's error detail rather than only a coarse failure class.

## Impact

- `packages/server-core/src/extensions/child.ts` — fatal-error reporting before `process.exit`.
- `packages/server-core/src/extensions/host.ts` — lifecycle diagnostics, restart supervision consuming `restartAt`, quarantine clearing on explicit restart.
- `packages/server-core/src/extensions/manager.ts`, `composition.ts` — supervisor wiring and restart entry point.
- `packages/server-core/src/activity/extensionAgentRuntime.ts` — `onAdmissionFailure` emission plus admission/binding success events.
- `electron/diagnostics/core.ts` — new `local-server.extension.*` and `local-server.agent.*` event names, and path redaction removed from `sanitizeDiagnosticText`.
- `electron/main.ts` — recording both callbacks on the existing bounded JSON Lines route.
- No renderer, protocol, or PTY surface changes. No new dependencies.
