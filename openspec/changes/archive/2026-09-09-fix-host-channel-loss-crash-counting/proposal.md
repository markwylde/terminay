## Why

The Claude Code extension quarantined itself again, and this time the diagnostics recorded what happened. One child process died, and the host counted it as ten crashes in two milliseconds:

```
14:41:46.867  child-exited  SIGKILL  deliberate=false
14:41:46.868  failed ×3   "agent lifecycle acknowledgement exceeds IPC limit"
14:41:46.869  failed ×7  →  quarantined
```

Three defects compound there, and the recorded message is wrong about all of them.

`ExtensionHost.send` returns `false` for three unrelated situations — no child, a disconnected channel, or a frame over the size limit — and each caller reports only one of them. An acknowledgement is four small fields against a 256 KB cap and cannot plausibly be oversized; the channel was already gone, as the exit recorded a millisecond earlier shows. The message sent an investigation after a size problem that does not exist.

A lost channel is then treated as a protocol violation, which terminates the child and counts a crash. Lifecycle publications are queued — up to 64 per context — and acknowledged asynchronously, so when the child dies every publication still in flight resumes, fails to acknowledge, and is counted again. One death became ten crashes.

That defeats quarantine's own guard. Five failures in a sixty-second window is meant to catch a crash *loop*; ten failures inside two milliseconds are one event counted ten times. Quarantine landed before the restart backoff scheduled for the first four failures could ever run, and a quarantined extension stays dead for the life of the application, so the Agents sidebar silently loses every terminal that provider was observing.

The real cause of death is then destroyed. `terminateChild` detaches the child's listeners, so its genuine exit code or signal never arrives and the host records a synthetic `SIGKILL` instead. The child sent no fatal report either, so it did not die of an uncaught exception — something else killed it, and the evidence was overwritten by the mishandling above.

Separately, and visible in the same history: a terminal that cannot bind re-runs discovery across every installed provider indefinitely. One terminal produced 6,673 observation records — roughly 590 a minute, one full sweep every 1.5 seconds — of which exactly one bound.

## What Changes

- A lost channel is reported as a lost channel. `send` distinguishes a missing or disconnected child from a frame that exceeds the message limit, so a caller can tell "the child is gone" from "this frame is too big" and the recorded diagnostic names the real one.
- A gone child is no longer a protocol violation. Failing to write to a channel that has already closed is the ordinary consequence of a child exiting, not evidence of a misbehaving child, and it neither terminates anything nor counts a crash.
- One death counts once. A failure observed after the child is already gone does not open a new crash; the host counts the death, not each caller that discovers it.
- The child's real exit status survives. The host records the exit code or signal the operating system reported before any teardown detaches the listener that carries it.
- Discovery that cannot bind backs off instead of sweeping forever. Re-arming grows an interval between attempts up to a ceiling and resets on real evidence — a topology change, a foreground change, or a return to the shell — so a late journal still binds while an unbindable terminal stops sweeping every provider every 1.5 seconds.

## Capabilities

### Modified Capabilities

- `extension-platform`: crash containment counts one child death once, distinguishes a closed channel from an oversized frame, and preserves the exit status the operating system reported.
- `agent-status-and-sidebar`: discovery that stays unbound re-arms on a widening interval that resets on new evidence, rather than at a fixed cadence forever.

## Impact

- `packages/server-core/src/extensions/host.ts` — the send result, protocol-violation handling, crash counting after a child is gone, and exit-status capture.
- `packages/server-core/src/activity/extensionAgentRuntime.ts` — re-arm backoff and the reset conditions.
- `packages/server-core/test/` — coverage for a burst of failed acknowledgements, exit-status preservation, and the backoff.
- No change to the extension API, any provider, or a renderer surface. No new dependencies.

## Known Gap

This does not explain why the child died. It removes the amplification that turned one death into an instant quarantine and restores the exit status that identifies the cause, so the next occurrence is diagnosable instead of self-erasing. Finding the killer remains open work.
