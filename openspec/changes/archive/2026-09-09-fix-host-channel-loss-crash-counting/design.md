## Context

`ExtensionHost.send` (`host.ts:623`) answers three different questions with one boolean:

```ts
if (this.child === undefined || !this.child.connected ||
    frameByteLength(frame) > this.limits.maxMessageBytes)
  return false;
```

Every caller then picks one of those meanings and reports it. `sendAgentLifecycleAck` reports "agent lifecycle acknowledgement exceeds IPC limit" and calls `protocolViolation`, which terminates the child and records a crash. An acknowledgement carries a context id, a publication id, two counts and a bounded failure string against a 256 KB cap, so the size branch is not reachable in practice — but it is the only branch the diagnostic ever names.

The amplification comes from the shape of the publication path. `handleAgentLifecyclePublication` is `async`: it awaits `ingestExtensionLifecycle` and acknowledges afterwards, and the bridge admits up to 64 queued publications per context. When the child dies, every publication still awaiting resumes, finds a closed channel, and calls `protocolViolation` — once each. The recorded history shows exactly that: ten failures across two milliseconds, restart backoff scheduled for the first four, quarantine on the fifth, and the remaining five recorded after the extension was already quarantined.

The exit status is lost to the same path. `protocolViolation` calls `terminateChild`, which calls `child.removeAllListeners()` before `kill('SIGKILL')`, so the `exit` event carrying the operating system's real code or signal is never delivered. What remains is the synthetic record written at termination — `SIGKILL`, `deliberate: false` — which describes the host's own kill rather than the death it was reacting to. The child also sent no fatal report, so this was not an uncaught exception in extension code.

Separately, `extensionAgentRuntime` re-arms discovery for an unbound terminal at a fixed cadence. The fast window is bounded at ten retries, and after it `unboundTopologyReobserve` makes the next topology sample re-admit; that sample re-runs the fast window, which exhausts, which re-arms the flag. The recorded history shows the resulting steady state: one sweep of every installed provider every 1.5 seconds — the topology poll interval — 6,673 records on a single terminal, one of which bound.

Boundary: this is ADR-0011's **Server → extension child** row. Crash isolation is the invariant, and the process boundary is meant to contain a child's failure — not to convert one failure into five.

## Goals / Non-Goals

**Goals:**

- A child that dies costs one failure, so quarantine still means a crash loop.
- A diagnostic names the situation that actually occurred.
- The exit status the operating system reported survives to the log.
- An unbindable terminal stops sweeping every provider forever, without losing late binding.

**Non-Goals:**

- Finding what killed the child. This change makes that diagnosable; it does not diagnose it.
- Changing the crash threshold, the crash window, or the backoff curve for genuine repeated deaths.
- Changing the extension API, any provider, or the fast ten-retry discovery window.

## Decisions

### `send` reports why it failed

`send` returns a result distinguishing `sent`, `channel-closed`, and `too-large` rather than a boolean. Callers that must react to a violation keep doing so for `too-large`; `channel-closed` becomes an ordinary outcome that ends the operation quietly.

The alternative — inspecting `this.child` at each call site before sending — was rejected because it duplicates the check and still races: the channel can close between the check and the write. The send itself is the only place that knows which condition actually stopped it.

### A closed channel ends the operation instead of accusing the child

`protocolViolation` exists to contain a child that is speaking the protocol wrongly. A closed channel is not that: it is what a dying child looks like from the writing side, and by then the exit path is already running. Treating it as a violation adds a redundant kill and a spurious crash to a death that is already being handled.

So a `channel-closed` result stops the operation and is recorded as a closed-channel diagnostic rather than a violation. The failure that matters — the child ending — is recorded once by the exit path that owns it.

### The death is counted, not its discoverers

Even with the above, several operations can still fail in one tick for reasons that would legitimately count. The host therefore counts a failure only while a child is present, and drains the rest: once the child is gone, later failures for that same incarnation are recorded but do not open a new crash.

Alternatives considered: rate-limiting `recordFailure` by time — rejected as a coincidence-shaped fix that would also swallow genuinely fast repeated deaths; and counting per publication id — rejected because it makes the crash counter depend on how much work happened to be in flight, which is precisely the bug.

### Termination preserves what the exit already said

`terminateChild` records that the host terminated the child, and no longer claims an exit status it did not observe. Where an exit was already observed, that record stands. The listener that carries the exit is detached only after the host has taken what it needs, so a real code or signal is never traded for a synthetic one.

This corrects a defect introduced with the lifecycle diagnostics: the synthetic `SIGKILL` record was added to guarantee that every stopped child leaves evidence, and instead it overwrote the better evidence in exactly the case that matters most.

### Discovery backs off, and evidence resets it

Re-arming after an exhausted window grows its interval — the topology poll interval, doubling to a ceiling — and resets to the base interval on new evidence: a changed topology signature, a foreground change, or a return to the shell.

This keeps the documented behaviour that a late journal still binds, since a journal appearing is a topology change, which resets the interval. What it removes is the steady state where nothing has changed and the terminal sweeps every installed provider anyway. A hard stop after N windows was rejected for the same reason the fixed cadence exists: a terminal that cannot bind now may bind in a minute, and a stop would need a new trigger to undo.

## Risks / Trade-offs

- **A late journal binds a little later than before** → Only when nothing else changed; any topology, foreground, or shell edge resets the interval immediately. The ceiling bounds the worst case to one sweep per ceiling rather than one per 1.5 seconds.
- **Draining failures after a child is gone could hide a real second crash** → The drain is scoped to the incarnation that already died; a restart creates a new child, and its death counts again. Repeated deaths still reach quarantine, which is covered by its own scenario.
- **`send` changing shape touches every caller** → It is one private method inside `ExtensionHost` with a small, enumerable set of call sites, each of which already decides what a failure means. The compiler finds them all.
- **A child that dies silently still leaves less than we want** → True, and unchanged by this work beyond restoring the exit status. The gap is stated in the proposal rather than implied to be closed.

## Migration Plan

None. No persisted state, protocol frame, or public API changes shape; the new diagnostic names are additive to the existing allowlist. Rollback is reverting the change.

## Open Questions

None blocking. What killed the child at 14:41:46 remains unknown and is deliberately out of scope; this change is what makes the next occurrence answerable.
