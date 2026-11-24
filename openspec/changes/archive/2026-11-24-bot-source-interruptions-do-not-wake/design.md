## Context

The server runs trigger sources inside the bot container by spawning `/usr/local/bin/terminay-source` under `terminay-run` over an engine exec stream. This is the ADR-0096 boundary: the source runs in the owning container, never on the host. The worker always reports through one JSON frame on stdout: a result frame, or an `{"error": ...}` frame when it catches an exception. `containerSourceRunner.run` treats "no frame" as `Source worker unavailable; recreate bot to update its image`. It discards stderr, ignores the exit status, and can also throw while iterating stdout (a stream `error`), from `childError`, or from cleanup in `finally`.

A run produces no frame when:

- `terminay-run` cannot exec the worker. Verified on podman: it prints `terminay-run: exec failed: …` and exits 127, both for a missing file and for permission denied.
- The server's own timer kills the run (`timeoutMs + 5 s`, or 10 s for tests).
- The stream breaks or the process is killed from outside. Examples: the host sleeps and the container VM is frozen, the container is still starting, or the engine drops the exec.

In `BotTriggers.launch`, a polled (command or HTTP) failure sets health to `failed` at once. That starts a condition failure episode and, under ADR-0099, may start a failure execution. Continuous sources already retry with backoff while health is `retrying`. `classified()` already maps an EAGAIN or process-limit message, using engine stats, to a structured `processes` cause.

## Goals / Non-Goals

**Goals:**
- Classify runs that end without a result from server state and exit status, with a defined precedence.
- Give the owner and the bot the worker's real diagnostics: bounded, and redacted before storage.
- Make a single interruption of a polled check cost nothing: no failure episode and no wake.

**Non-Goals:**
- Detecting host sleep or wake explicitly. The retry covers it without a new signal and without polling (ADR-0028).
- Changing continuous-source reconnect, the follow-up exclusions, coalescing, caps, or the worker and image.
- Shortening slow user poll scripts.

## Decisions

**Precedence, one place.** The runner records the stream's `exit` code (`SocketProcess` emits `exit` and `close` with the code), whether its own deadline timer fired, and any stream error. All of these are folded into one outcome after the read loop ends, whether the loop ended at EOF or by throwing. An error frame or a validation or limit error raised while parsing a frame keeps its current behaviour. Otherwise, with no frame, the order is: signal aborted → `conflict` "Source cancelled"; deadline fired → `deadline` "Source check exceeded its N s limit"; exit 126 or 127 → `unavailable` "The source worker could not be executed in the bot's container; recreate the bot to update its image"; anything else, including a stream error or an unknown exit status → `interrupted` "Source check was interrupted before it reported". Classification never parses stderr text (ADR-0099). The error then passes through `classified()` unchanged, so an exhausted process limit still becomes a `BotBlockedError` with the `processes` cause and is not retried.

**Cleanup outcome is reported, not thrown over the result.** The `finally` cleanup (`terminay-run --kill`) no longer replaces the primary error. Its success is recorded on the thrown error as `cleaned: boolean`, and that value decides whether a retry is allowed.

**Diagnostics are bounded, and redacted before storage.** Stderr goes into a tail buffer capped at 4 KiB while reading. The runner attaches the exit status and the raw tail to the error as `diagnostics` and leaves them out of `message`. If the buffer overflowed, it drops everything up to the first newline, so a secret cut at the boundary does not leave a fragment. In `BotTriggers`, the health error is built as `message + " (exit N)"`, followed by the tail once it has been passed through `service.redactMessage(botId, …)` (bot credential and runtime secrets) and the runner's header-secret substitution, and then cut to its last 1 KiB. If redaction throws, only the tail is omitted. Health and failure follow-ups therefore never see unredacted stderr. *Alternative:* forwarding all of stderr. Rejected because it is unbounded and could leak.

**Retry inside `launch` for polled sources only.** When `work()` throws code `interrupted` with `cleaned: true`, the source is command or HTTP, the run is not a test, the controller has not been aborted and the trigger is still current, then `launch` does three things. It patches health to `{state: 'retrying', error, nextRetry}`. It waits on a timer that `controller.signal` can abort (an injectable `sourceRetryDelayMs`, default 5000). Then it runs `classified(runner.run(...))` once more under the same worker entry, so checks never overlap. A scheduled tick that falls due meanwhile skips, as it already does while a check is running, and the next check covers that time. The retry's outcome takes the normal success or failure path. `retrying` already neither starts nor ends an episode, so the follow-up code needs no change. Disable, edit, reset, delete, bot disable and server stop already abort the worker controller through `stopSource` and `reconcileSources`. *Alternative:* re-schedule at the next interval tick. Rejected because health would sit in an ill-defined state for a full interval. *Alternative:* retry every failure. Rejected because real script failures should surface at once.

**Over-time-limit is not retried.** A script that outruns its limit will most likely do so again, and the owner needs to see it.

## Risks / Trade-offs

- [Replaying a command can repeat side effects: the first run may have finished its external work before its result was lost] → Trigger commands are observations by contract (bot-triggers "Source test isolation" already warns that a source can have side effects). The retry runs only after container-side cleanup confirms the first process group is gone, never concurrently, and at most once.
- [A broken stream that recurs every check doubles the exec count] → Only one retry per check. The second failure records normally, and every episode, exclusion and cap rule applies.
- [A 5 s retry right after wake can still meet a frozen VM] → The check then fails and may wake the bot once, as before, but the reason explains itself.
- [The engine reports a non-127 code for a worker that cannot run] → It falls back to interrupted, which retries once and then fails with a clear reason.

## Migration Plan

Server-only change, with no stored-format or protocol change. Rollback is a revert.

## Open Questions

None. This stays within ADR-0096 (container-side execution), ADR-0099 (structured causes, episodes, server-owned wakes) and ADR-0028 (no polling).
