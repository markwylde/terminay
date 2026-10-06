## Context

A PTY callback travels synchronously through the server: the session holder (or
the in-process `node-pty` adapter) hands bytes to `TerminalService.appendOutput`,
which retains them in the session's replay, feeds the presentation checkpoint,
and emits a `TerminalEvent` to every listener, one of which is the desktop's
`ServerTerminalAuthority`. A repainting TUI makes that trip 300–450 times a
second, indefinitely.

Three steps on that trip do work that is not proportional to the event:

1. `ServerTerminalAuthority.handleEvent` keeps recent output as one
   `Uint8Array` per session and, per event, allocates `previous + event`,
   copies both in, then `slice`s the tail back down to `maxReplayBytes`
   (1 MiB). Once a session has printed a megabyte, every event allocates and
   moves about 2 MiB. Measured: 110.8 µs per event against 7.5 µs with a 4 KiB
   bound.
2. `TerminalService.appendOutput` keeps the replay as an array of chunks and
   bounds it with `while (replayBytes(replay) > max) replay.shift()`, where
   `replayBytes` is a `reduce` over the whole array. Measured: 250.8 µs per
   chunk with 65,000 retained chunks against 1.8 µs with 256.
3. Both PTY adapters call `foreground.poll()` on every chunk.
   `createForegroundObserver` coalesces to one sample in flight and one
   pending, but its `finally` starts the pending sample the moment the previous
   one settles, so under continuous output samples run back to back. Each is an
   `execFile('ps', ['-axo', …])` over the host process table. Measured: 400
   samples for 400 chunks in-process; 250 for 249 frames in 2 s through a real
   holder; 41.7 `ps` processes a second in the composed app.

Constraints that shape the fix:

- The stream-recovery contract (`terminal-stream-congestion-and-recovery`)
  depends on the replay's exact semantics: positions, `replayFrom`, whole-chunk
  eviction, the `maxOutputChunkBytes` split. None of that may move.
- The authority's recent-output buffer has a different lifecycle from the
  service's replay. It is created before the session exists (`create` seeds it
  for a requested id), and it is deliberately kept after the shell exits so a
  reopened project can still read it.
- Foreground observation feeds `foregroundBusy`, which gates destructive close.
  The comment at `nodePty.ts:141` records why output drives a sample at all: a
  starved interval timer must not leave close protection stale.
- ADR-0021 is in force: a debounce is not a rate limit, work whose cost matters
  is bounded by a minimum interval, and spawning per sample is a design error.
- ADR-0028 is in force: work that follows an observed event runs behind the
  one shared ramp, new polls need the owner's approval, and whatever starts
  observing also stops it. This change adds no poll.
- ADR-0035 is in force: the packaged desktop runs PTYs in a detached session
  holder, so the holder path, not the in-process one, is what users run.

## Goals / Non-Goals

**Goals:**

- Per-event work on the output path is proportional to the event's bytes.
- Output-driven host sampling is bounded per unit time, per session.
- Byte-for-byte identical replay contents, positions, bounds, and
  close-protection outcomes.
- Regressions are caught by tests that assert scaling, not wall-clock
  thresholds.

**Non-Goals:**

- Moving presentation checkpointing off the main thread, or making snapshots
  lazy.
- Sharing one immutable event across listeners, or typed subscriptions.
- Throttling the activity reducer.
- Coalescing output in the holder before framing.
- Replacing `ps` with a native call (ADR-0021 open item; a packaging decision).
- The split-UTF-8 defect in recordings.

All of these were measured together at 2.7% CPU after the three fixes. They are
left exactly as they are.

## Decisions

### 1. One bounded chunk queue, used by both retainers

Add a small data structure in
`packages/server-core/src/terminalService/` — a queue of byte chunks with a
running byte total and a head index — and use it in both places that retain
output.

- `push(chunk)` adds the chunk's length to the total.
- Eviction advances a head index and subtracts the evicted length; the backing
  array is compacted only when the dead prefix exceeds half its length, so
  eviction is amortised constant time and never an `Array.shift()` on tens of
  thousands of entries.
- The total is maintained, never recomputed.

The two users keep their own eviction rule, because they promise different
things:

- **`TerminalService` replay** evicts whole chunks while the total exceeds
  `maxReplayBytes`, exactly as today. `replayFrom`, position arithmetic,
  `readReplayBytes`, and subscription replay iterate the live range and are
  otherwise untouched.
- **Authority recent output** must expose exactly the last `maxReplayBytes`
  bytes, so it evicts a chunk only when the chunks after it already cover the
  bound, and trims the oldest surviving chunk when read. `getBuffer`,
  `aiReplay`, and `generateAiMetadata` call one `read()` that concatenates the
  tail. Reads are rare (a user action or an AI request); events are not.

*Alternative: delete the authority's buffer and read the service's replay.*
Rejected. It is the tidier end state, but the two do not have the same
lifetime — the authority's copy outlives the session's exit and exists before
the session does — and the service evicts whole chunks, so it would return
fewer bytes than today. Getting that right means changing what a reopened
project and AI metadata see, which is a behaviour change riding on a
performance fix.

*Alternative: a fixed 1 MiB ring buffer per session.* Rejected. Constant-time
and simple, but it commits a megabyte per terminal up front, including for
terminals that print a prompt and sit idle, and it cannot serve the service's
replay, which needs chunk positions.

*Alternative: keep the `Uint8Array` and grow it geometrically.* Rejected. It
removes the allocation but still moves up to a megabyte on every trim.

**Boundary:** the structure lives in `server-core` and is imported by
`electron/`, the same direction as every existing import. It holds bytes the
authority already holds; no data crosses the session or project boundary that
did not before.

### 2. Put output-driven samples behind the shared ramp, inside the observer

ADR-0028 decision 5 already says how work that follows an observed event is
damped, and that there is one implementation of it:
`createRampSchedule` in `packages/server-core/src/activity/rampSchedule.ts` —
run promptly after a quiet period, then no sooner than 1 s, 2 s, 3 s, 5 s,
10 s, 20 s apart while events keep arriving, with events inside an interval
collapsing into one run at its end. PTY output is an observed event; a host
sample is the work that follows it. The defect is that this one site never
went behind the ramp.

`createForegroundObserver` already owns coalescing, epochs, and fences, so the
ramp belongs there, not at the two call sites.

- The observer gains `noteOutput()`, which is `ramp.request()`. The ramp's
  run is the existing `requestSample()`. Both adapters call `noteOutput()`
  where they call `void foreground.poll()` today.
- The first output after quiet runs synchronously inside `request()`, on the
  output callback itself, with no timer involved. That is the property the
  `nodePty.ts:141` comment protects, kept as it is.
- Nothing else in the observer changes. `inFlight`/`pending` coalescing and
  the restart in `finally` stay; they now see at most one output-driven
  request per ramp interval instead of one per chunk, so "back to back" cannot
  occur.
- `observeFresh` — destructive close — does not go through the ramp. It
  starts or supersedes a sample immediately, exactly as today.
- The ramp is created per observer and disposed with it, so it is owned by the
  session's lifecycle (ADR-0028 decision 6). Its clock and timer are injectable
  through `NodePtyForegroundPollingOptions` for tests.
- The 1500 ms interval timer and its `poll()` are not touched. It is an
  existing, unapproved poll listed in ADR-0028's open items, whose candidate
  replacement is shell integration; removing or approving it is the owner's
  decision in its own change. While it exists it also bounds how stale the
  passive projection can be under a wide ramp.

*Alternative: a new fixed minimum interval (for example 500 ms) in the
observer.* Rejected. It would work, but it is a second damping implementation
with its own constant, which is what ADR-0028 decision 5 rules out.

*Alternative: throttle at the call sites.* Rejected. Two call sites today, and
the fence that must bypass the damping lives in the observer; splitting the
rule from the state it depends on is how the bypass gets lost.

*Alternative: drop the output trigger and rely on the 1500 ms interval.*
Rejected. It undoes deliberate work — output after quiet is the best cheap
signal that a command just started — and it leans harder on a poll the
repository intends to remove.

*Alternative: a trailing debounce.* Rejected by ADR-0021 rule 4, and wrong
here specifically — a TUI never goes quiet, so a debounce would never fire.

**Boundary:** observation stays exact-session. Each observer has its own ramp,
so one terminal's output cannot delay or accelerate another's sampling, and
nothing about the ramp is visible to a client. `terminalService/` importing
from `activity/` is a new edge inside `server-core`; if the workspace boundary
check objects, the ramp moves to a neutral module and both import it — still
one implementation.

### 3. Tests assert scaling, not time

Each cost test builds two instances that differ only in the quantity that must
not matter (retained bytes, retained chunk count), measures the same small
event against both, takes the best of several rounds, and asserts a ratio with
a wide margin (≤ 4× where the defect is 15–140×). Rate tests count host
samples against a budget derived from elapsed time. Neither asserts an absolute
duration, so they do not depend on runner speed.

Each failing test sits beside a guard that passes today and must keep passing:
the replay stays bounded and contiguous; the authority returns exactly the last
`maxReplayBytes` in order; a close observation is answered by a fresh sample at
once. The existing `node-pty coalesces continuous output into one in-flight
sample and one pending sample` test encodes the close fence and must pass
unmodified.

## Risks / Trade-offs

- [A foreground change during continuous output reaches the passive projection
  later than today — by up to the ramp interval, bounded in practice by the
  existing 1500 ms interval sample] → Close protection asks for its own fresh
  sample and is not behind the ramp. Output after quiet still samples at once,
  which covers a command starting.
- [The run at the end of a ramp interval depends on a timer] → It is the shared
  ramp's existing behaviour, already relied on by agent discovery. The first
  sample after quiet does not use a timer, and close protection does not use
  the ramp.
- [Replay semantics drift while changing its container] → The service keeps
  whole-chunk eviction and the same iteration order; the existing replay,
  congestion-recovery, hydration, and output-read suites are the regression
  net, and the new contiguity guard asserts positions across the eviction
  boundary.
- [Timing-ratio tests flake on a loaded runner] → Best-of-five and a margin an
  order of magnitude inside the defect. If one still flakes, widen the workload,
  not the threshold.
- [The authority tests gate nothing] → `test:server-terminal-runtime` is not in
  `smoke` or CI. Wiring it in is a task, done after the fix so `main` is never
  red.

## Migration Plan

No data or protocol migration. The change is internal to one process and ships
as an ordinary release; reverting the commit restores the previous behaviour.

## Open Questions

- Whether the authority's recent-output copy should eventually be served from
  the service's replay. It needs the exit-retention and exact-tail behaviour
  specified first; out of scope here.
- No in-force ADR needs revisiting. The general rule this change follows for
  the output path is recorded as a new ADR beside ADR-0021 rather than as an
  amendment to it.
