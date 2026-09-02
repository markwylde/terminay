## Context

See proposal.md. The concrete defects were symptoms of one cause. Initial
WebRTC pairing began a renderer generation with the transport origin but
disposed it by profile id, so which path mounted the workspace determined
whether cleanup worked. The terminal Retry callback captured a specific client
and renderer attempt; once correct disposal invalidated that attempt, the
still-mounted button was rejected as `stale-close-ignored`. In other paths,
mismatched identity accidentally left the generation current. Panel-local state
could clear the visible error before a replacement transport and terminal
attachment were usable.

This change depends on the single-owner WebRTC transport generations work,
which supplies the session host that the controller injects as its transport
operation.

## Goals / Non-Goals

Goals:
- One controller owns activation and recovery across renderer hosts.
- Mounted workspaces recover atomically: never connected-looking while a
  post-recovery command still cannot reach the server.
- The superseded mechanisms are deleted, not wrapped.

Non-Goals:
- Changing the transport generation model itself.

## Decisions

### One stable connection identity

The controller is keyed only by stable profile id plus verified server and
session identity. It owns one monotonic attempt sequence and one explicit state
union: idle, connecting, authenticating, resubscribing, hydrating, connected,
retry-wait, blocked, stopped. It also owns the active client and context, the
confirmed workspace and terminal watermarks, the abort signal, the retry timer,
candidate disposal, and atomic activation. React only subscribes to its
immutable state.

### Transport acquisition is injected

Transport acquisition is an injected host operation. WebRTC uses the session
host; direct WebSocket and Desktop MessagePort providers satisfy the same
replacement interface. The renderer state machine contains no
transport-specific branches.

### One activation and recovery path

Pairing and enrollment complete before the stable profile is created or
updated; that profile is then activated through the same controller used for a
remembered profile, and the separate connected-context construction branches
were removed. Initial open, auto-restore, explicit profile selection, transport
close, application-send failure, and Retry are all controller events rather than
direct client construction or nested recoveries.

At generation retirement the old client is disposed and fenced synchronously.
A candidate is published as connected only after it has fully authenticated,
resubscribed, loaded the authoritative workspace, and hydrated terminal panels.
The mounted workspace presentation is preserved during recoverable failure but
never its command authority; explicit disconnect, forget, credential
replacement, and profile switch unmount it deterministically. Retries are
bounded per attempt with backoff but persistent across retryable failure, and
manual Retry cancels the wait and starts a fresh current attempt immediately.

### Terminal boundary

An uncertain terminal input queue is closed and discarded immediately: later
keys are not accepted until the new attachment is current, and input whose
delivery outcome is unknown is never replayed. The prior terminal emulator and
its confirmed render position are kept, then resumed or checkpoint-hydrated
against the replacement client exactly once. Recovery presentation is cleared
only after the replacement attachment can deliver a probe or real command and
receive its confirmed result.

## Risks / Trade-offs

- Discarding uncertain queued input can lose keystrokes typed during a failure.
  This is preferred to replaying input whose delivery outcome is unknown.
- Holding the recovery presentation until a command round-trips confirms means
  a slightly later "connected" indication, in exchange for never showing
  connected while the server is unreachable.

## Migration Plan

No compatibility wrappers were retained around the deleted classes. Tests that
asserted callback wiring by source regex were replaced with runtime
state-machine and mounted-panel behaviour tests, and static dependency and
source checks assert the superseded gates, recovery classes, captured retry
callbacks, and duplicate activation paths are gone.
