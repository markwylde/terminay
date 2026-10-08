## Context

`ExtensionHostManager.startOne` awaits `host.start`, then publishes the host's
contributions under the contribution mutation lock. Publication re-reads the
host's status and throws if it is no longer `running`; the catch stops the
host and rethrows. That catch was written for a host that is up but cannot
publish, which is the contribution ownership conflict.

`ExtensionHost.recordFailure` runs when the child dies. It counts the crash,
moves the host to `failed` with a `restartAt`, and the composition's
`superviseRestart` schedules the restart. `ExtensionHost.stop` on a host with
no child moves it to `stopped`, and `superviseRestart` treats a non-failed
transition as a reason to cancel the pending restart.

When the child dies inside the publication gap, both halves run in sequence:
the crash schedules a restart, then the manager's catch stops the host and the
supervisor cancels it. The host ends `stopped` with nothing pending. The
composition's restart callback records the activation failure on the
installer, which is correct, but nothing ever tries again.

No security boundary is crossed. The manager, the host, and the supervisor
all live inside Terminay Server's extension runtime.

## Goals / Non-Goals

**Goals:**

- A crash anywhere in a host's life, including the publication gap, is
  supervised: counted, backed off, retried, and quarantined on the same terms.
- A host that is up and cannot publish is still stopped, so a conflict never
  leaves a running child with unpublished contributions.
- The supervisor test decides the outcome deterministically.

**Non-Goals:**

- Changing how the supervisor reacts to `stopped`. A deliberate stop must
  still cancel a pending restart.
- Publishing contributions from a host that failed. The activation still
  fails and the installer still records it.

## Decisions

**Stop only a host that is still up.** In `startOne`'s catch, read the host's
status. If it is `failed` or `quarantined`, the host has already accounted for
what happened and the supervisor is already acting on it, so the manager
rethrows without touching it. Any other state means the host is up and the
publication failed on its own terms, and the stop stays.

The alternative was to make `superviseRestart` ignore a `stopped` transition
that follows a `failed` one. That would make every deliberate stop ambiguous
and was rejected.

**Force the gap in the test.** The regression test wraps the manager's
contribution mutation so the publication that follows a start waits for the
child to die first. Ownership cleanup after a deliberate stop sees a host that
is not running and is not held, which keeps `activate`'s stop-then-start from
waiting on itself.

## Risks / Trade-offs

- The regression test reaches the manager's contribution mutation by name.
  If that method is renamed the test fails loudly rather than silently
  passing, which is the acceptable direction.
