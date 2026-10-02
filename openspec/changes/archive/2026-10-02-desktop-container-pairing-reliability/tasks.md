## 1. Desktop pairing and persistence

- [x] 1.1 Resolve direct `/v1/` links before loopback hosted-session classification and classify saved loopback direct origins consistently. Verify: protocol URL tests cover localhost, IPv4 and IPv6 loopback, hosted session URLs, and HTTP embedded links.
- [x] 1.2 Persist sanitized Desktop profile metadata immediately after successful device enrollment and retain it when initial reconnect or workspace loading fails. Verify: a focused main-process test proves profile persistence and device identity survive the first-load rejection without serializing the pairing URL or fragment.

## 2. WebRTC recovery and diagnostics

- [x] 2.1 Keep Desktop peer and required-lane liveness monitoring active after setup, with one terminal failure callback, degraded-ICE feedback, and the existing ICE recovery grace behavior. Verify: lifecycle tests cover late failure, channel closure, transient ICE disconnect, grace expiry, and duplicate events.
- [x] 2.2 Record the selected candidate pair and changes in Desktop and standalone server structured diagnostics, excluding credentials, SDP, addresses, ports, and application content. Verify: tests assert candidate type, protocol, state, and sensitive-field absence.
- [x] 2.3 Verify both Desktop and server diagnostic emitters omit candidate addresses and ports, including when the stats object is malformed. Verified by the shared stats-projection test with sensitive fields and malformed maps, and by Desktop/server logger tests that retain route classes while omitting sensitive network identifiers.
- [x] 2.4 Keep `api` and `asset` bootstrap lanes non-fatal after open; test late lane closure behavior. Verified by server lifecycle and Desktop liveness regressions for post-open bootstrap-lane closure.

## 3. Pairing room and user feedback

- [x] 3.1 Invalidate a consumed pairing room synchronously with successful approval while preserving its authenticated peer. Verify: hosted approval integration tests prove immediate room rotation and that a stale-room join cannot replace the approved peer.
- [x] 3.2 Add explicit pairing progress, prevent concurrent attempts, normalize IPC errors, and show actionable used-link and connection-loss recovery. Verify: protocol and UI regressions cover lifecycle states, disabled submit, and friendly known/unknown error formatting.
- [x] 3.3 Correct known-error matching, correlate progress to the active pairing attempt, and cover stale-room rejoin recovery. Verified by error-copy and protocol-event tests, active-attempt filtering, and stale-room close-reason regressions.
- [x] 3.4 Enforce strict string validation for progress states and make its negative test exercise the invalid state itself. Verified by rejection tests for array, numeric, and null states with no unrelated envelope fields.
- [x] 3.5 Serialize shared pairing-room rotations and await room retirement before approval or denial completes; test concurrent exposure refreshes and preserve the stalled-authentication regression. Verified by shared-generation and full-refresh serialization tests, approval/denial socket tests, and the stalled-authentication integration test.

## 4. Listener and CLI behavior

- [x] 4.1 Serve the direct-link explanation at `/v1/`, prefer hosted QR output when both modes are enabled, and classify public ready-log URLs by exposure mode. Verify: local listener and CLI tests assert page content, QR selection, and correct URL class.
- [x] 4.2 Warn when a loopback direct signaling URL has no advertised UDP media route and provide actionable `sudo`-missing or helper-permission errors. Verify: CLI tests cover the warning and the missing-`sudo`/inaccessible-helper error mappings.
- [x] 4.3 Label direct QR output as Desktop-only and cover npx helper child-exit failures, empty advertised-address values, invalid direct origins, and credential-bearing `/v1/` requests. Verified by CLI, install-validation, and direct-listener tests.

## 5. Operator documentation and integration

- [x] 5.1 Update the standalone runbook and `terminay.com` remote-access guidance for foreground containers, hosted QR links, direct browser behavior, UDP reachability, and transient disconnects. Verify: documentation tests assert the platform distinction and recovery guidance.
- [x] 5.2 Run focused regression tests, OpenSpec validation, type checks, and the Docker-isolated Electron E2E suite. Verified by pull-request CI, including all ten E2E shards.

## 6. Review follow-up

- [x] 6.1 Run the pairing sequence through one tested module and reducer; report `connection-lost` only after the profile is saved, and `connected` only after the workspace mounts. Verified by `scripts/desktop-pairing-attempt.test.mjs`.
- [x] 6.2 Add a cancel action that aborts the attempt in the privileged host, and release approval waits and pending requests when the peer is lost. Verified by API-lane tests and the real-WebRTC loss and cancel cases in `scripts/desktop-hosted-connection.test.mjs`.
- [x] 6.3 End a Desktop peer whose ICE stays disconnected for 15 seconds, and close data lanes before the peer so the server withdraws a departed device's pending approval. Verified by the same real-WebRTC cases.
- [x] 6.4 Strip error class names from displayed errors, map unanswered and lost connections to reachability guidance, and keep unrelated permission errors out of the CLI helper hint. Verified by error-copy and CLI tests.
- [x] 6.5 Correct the runbook's QR default, complete the foreground container recipe, and document candidate-pair diagnostics and the misleading ICE line. Replace source-matching tests with behavioural ones and run the Desktop pairing suites in `test:ci`.
- [x] 6.6 Hand the privilege-dropped socket client to the service account as source rather than as a path into the CLI install, so `sudo npx terminay daemon qr-code` works with a dedicated service account. Verified by a CLI test that runs the dropped command against a real Unix socket from a directory with no access to the package.
- [x] 6.7 Run the real-peer pairing tests in pull-request CI. A separate `Real WebRTC pairing` job stages the selected runtime and runs the Desktop and server tests that otherwise skip.
