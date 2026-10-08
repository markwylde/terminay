## Why

An extension host that crashes in the moment between coming up and having its
contributions published stays dead. The person sees the extension's agent
observation vanish from every terminal, and only an explicit Restart brings it
back, even though the host recorded the crash and worked out when to retry.
The same gap is what has been turning the "Build, lint, and unit tests" job red
on `main`: the supervisor test's fixture crashes a few milliseconds after
activation, and on a loaded runner that lands inside the gap.

## What Changes

- A host whose child dies after `start` resolves but before the manager
  publishes its contributions keeps its `failed` state and its scheduled
  restart. The manager no longer stops it, because a deliberate stop cancels
  the pending restart and hides the crash behind `stopped`.
- The manager still stops a host that is running when publication fails for a
  reason of its own, such as a contribution ownership conflict.
- The supervisor test forces the crash into that gap so the outcome no longer
  depends on runner load, and the fake clock reports the host's transitions
  when no restart arrives.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `extension-platform`: the "A failed host is restarted under supervision"
  requirement states that a crash before contribution publication is
  supervised like any other crash.

## Impact

- `packages/server-core/src/extensions/manager.ts` — `startOne` stops a host
  after a failed publication only while that host is still up.
- `packages/server-core/test/extension-restart-supervisor.test.mjs` — a
  regression test for the gap, and a fake clock whose failure names the host's
  state and transitions.
- No protocol, client, or privileged surface is touched.
