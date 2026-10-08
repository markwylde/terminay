## Context

`ExtensionHost` forks one child per extension and exchanges JSON frames over
the IPC channel. Desktop main runs the embedded server in-process and binds
`bindFatalProcessDiagnostics`, which records `main.uncaught-exception` and
then calls `process.abort()`.

Node's `ChildProcess.send(message)` without a callback reports a refused write
(EPIPE once the peer has died but before `disconnect` is processed) by
emitting `error` on the `ChildProcess` on the next tick. An `EventEmitter`
that emits `error` with no listener throws. The host registered
`child.once('error')`, so a burst of acknowledgements to a dead child consumed
the listener with the first refusal and threw on the second.
`terminateChild` also called `removeAllListeners()` before `kill()`, leaving a
late refusal nothing to land on.

`send()` returns `false` when the channel's write queue exceeds its threshold;
the frame is queued. Verified with Node 24: a child sending 50 frames of 40 KB
to a busy parent got `false` 46 times, and every frame arrived.

## Goals / Non-Goals

**Goals:**

- No error from an extension child, its channel, or its termination can
  become an uncaught exception in the hosting process.
- A backlogged channel does not kill a healthy child or produce
  `channel-closed` records for one.
- The next time an extension or main-process failure happens, the history
  says which frame, which system error, and which file and line.
- The same unheard-`error` shape elsewhere in Desktop main is closed.

**Non-Goals:**

- Changing the abort-on-uncaught-exception policy in Desktop main. Continuing
  after an arbitrary uncaught exception leaves the process in an unknown
  state; the fix is to own every failure that is expected, which is what this
  change does.
- Throttling lifecycle publication bursts at the provider.

## Decisions

**Pass a callback to every host-to-child `send`.** With a callback Node never
emits `error` for the write, so the failure is handled where it happened. The
first refusal for a child is recorded as `channel-write-failed` with its
error code; later ones only increment a counter reported on `child-exited`,
because the incident produced hundreds of identical records in two
milliseconds. The persistent `error` listener stays as a second line: spawn
and kill failures still arrive there.

**The first `error` from the current child counts as its failure; later ones
are recorded only.** This keeps "one child death counts once" while making
every event visible.

**`false` from `send()` means queued.** Only a thrown exception or a failed
precondition (unserializable, oversized, disconnected) is a refused frame on
the child side. Once the host has really gone, the child's `disconnect`
handler exits it.

**Keep `file:` URL paths in the sanitizer.** The requirement already retains
filesystem paths inside errors and stacks; a `file:` URL is one written as a
URL. Query and fragment are still dropped, and every other scheme is still
reduced.

**Main-process helper streams log through `console.warn`.** Desktop main's
stderr is already captured as `main.stderr`, so these low-frequency failures
become visible without threading a diagnostics sink into each service.

## Risks / Trade-offs

- [A child whose host is wedged no longer fails fast on a long queue] → the
  host's own call timeouts and the `disconnect` handler still bound it.
- [Recording only the first refused write hides the timing of later ones] →
  the count on `child-exited` keeps the total, which is what separates one
  late acknowledgement from a flood.
