## 1. One stable connection identity and controller

- [x] 1.1 Define one controller keyed only by stable profile id plus verified server and session identity, with URL, origin marker, client id, React mount, and transport attempt excluded as generation keys, verified by the controller identity tests
- [x] 1.2 Give the controller one monotonic attempt sequence and one explicit state union covering idle, connecting, authenticating, resubscribing, hydrating, connected, retry-wait, blocked, and stopped, verified by the state-machine tests
- [x] 1.3 Make the controller own the active client and context, confirmed workspace and terminal watermarks, abort signal, retry timer, candidate disposal, and atomic activation, with React subscribing only to its immutable state, verified by the controller ownership tests
- [x] 1.4 Model transport acquisition as an injected host operation satisfied by WebRTC, direct WebSocket, and Desktop MessagePort providers without transport-specific branches in the state machine, verified by the provider substitution tests

## 2. One activation and recovery path

- [x] 2.1 Complete pairing and enrollment before creating or updating the stable profile, then activate that profile through the same controller used for a remembered profile, removing the separate connected-context construction branches, verified by the activation path tests
- [x] 2.2 Route initial open, auto-restore, explicit profile selection, transport close, application-send failure, and Retry through controller events rather than direct client construction or nested recoveries, verified by the entry-path tests
- [x] 2.3 Dispose and fence the old client synchronously at generation retirement, and fully authenticate, resubscribe, load the authoritative workspace, and hydrate terminal panels before publishing a candidate as connected, verified by the retirement and activation tests
- [x] 2.4 Preserve the mounted workspace presentation during recoverable failure but never its command authority, and unmount deterministically on explicit disconnect, forget, credential replacement, and profile switch, verified by the mounted-panel behaviour tests
- [x] 2.5 Make retries bounded per attempt with backoff but persistent across retryable failure, with manual Retry cancelling the wait and starting a fresh current attempt immediately, verified by the retry scheduling tests

## 3. Stable UI and terminal boundary

- [x] 3.1 Replace `requestConnectionRecovery` closures captured from a client with one stable controller `retry()` action supplied by current profile identity, verified by the retry-after-disposal tests
- [x] 3.2 Drive connection banners, terminal overlay, button availability, accessibility announcements, and input enablement solely from controller state plus terminal-attachment hydration state, verified by the presentation tests
- [x] 3.3 Close and discard an uncertain terminal input queue immediately, accepting no later keys until the new attachment is current and replaying no input whose delivery outcome is unknown, verified by the input safety tests
- [x] 3.4 Keep the prior terminal emulator and confirmed render position, then resume or checkpoint-hydrate it against the replacement client exactly once, verified by the hydration tests
- [x] 3.5 Clear recovery presentation only after the replacement attachment can deliver a probe or real command and receive its confirmed result, verified by the presentation-clearing tests

## 4. Delete superseded lifecycle code

- [x] 4.1 Delete `BrowserConnectionAttemptGate`, `RendererConnectionGeneration`, `RendererConnectionRecovery`, duplicated `recoverConnection` branches, and stale callback diagnostics, verified by static dependency and source checks
- [x] 4.2 Delete transport-specific auto-restore suppression, origin and profile key workarounds, fire-and-forget active-context disposal, and panel-local optimistic reconnect state, verified by static dependency and source checks
- [x] 4.3 Replace source-regex tests for callback wiring with runtime state-machine and mounted-panel behaviour tests, retaining no compatibility wrappers around the deleted classes, verified by the replaced test suite
