## 1. Reconnect the remote transport

- [x] 1.1 Extend the remote document endpoint and preload bridge with a source-bound recovery request. Start a fresh authenticated transport for a stale current generation, bypass backoff on Retry, and join attempts already running. Verify in `scripts/remote-endpoint-reconnect-retry.test.mjs` with a silent transport whose channel stays open, a controlled backoff, and concurrent triggers.
- [x] 1.2 Coordinate the deadline and cancellation across hosted negotiation, document endpoint handoff, application hello, and workspace hydration. Verify that a stalled phase fails visibly, a subsequent attempt succeeds, and late handoffs or closes cannot alter the newer document, binding, or another window. Retain the existing main-frame and subframe tests.
- [x] 1.3 Send the remote workspace a scoped Electron resume hint and reuse the immediate heartbeat probe. Verify with a controlled clock that a visible document probes on native wake, a responding peer is kept, an unanswered probe requests a fresh transport, and a simultaneous visibility signal does not fork recovery. Exercise an expired or revoked identity and verify that recovery stops at a pairing action.
- [x] 1.4 Record the recovery request, start or join, classified outcome, and endpoint handoff in Desktop diagnostics. Verify the sequence on successful and timed-out attempts and assert that diagnostic fields are bounded and contain no addresses, credentials, or application content.

- [x] 1.5 Return a signed revocation refusal to a revoked device that proves its paired key, and verify it on Desktop with the pinned host key and current join nonce. Verify signed responses, forged and replayed signatures, and clients that omit the opt-in.

## 2. Make Retry visibly respond

- [x] 2.1 Bind Retry feedback to the current recovery attempt. Verify in the renderer recovery tests that activation immediately shows progress in backoff and during an in-flight attempt, replaces the stale timeout, and returns to an actionable failure if the attempt fails.
- [x] 2.2 Style the recovery button's foreground, background, and focus indicator together. Verify computed label contrast of at least 4.5:1 in default, hover, and keyboard-focus states, visible keyboard focus, and activation by click and Enter in the recovery screen fixture.

## 3. Prove recovery in Desktop

- [x] 3.1 Extend the standalone-server Desktop E2E fixture to stall an authenticated application lane without closing it, replay wake and Retry, and verify a fresh authenticated connection in the same document. Verify that a running PTY retains its identity and accepts input after hydration, and another window keeps its peer. Run through `npm run test:e2e` in Docker.
- [ ] 3.2 Confirm the real wake path on packaged macOS against a compatible standalone server. Record sleep and wake, recovery or Retry feedback, replacement peer and endpoint diagnostics, and resumed terminal input without a reload.
- [x] 3.3 Run both targeted Node suites with `--test-force-exit --test-timeout=120000`, the affected TypeScript checks, and `openspec validate --all`. Record the test results before closing the change.

## Verification notes

- The targeted Node suites and adjacent registry, preload transport, and lifecycle suites passed 46 tests. TypeScript and strict validation of this change passed. The repository-wide OpenSpec check reported the same eight failures as the starting branch.
- The native wake probe, coalescing, and explicit pairing refusal passed automated tests. The revised server responds to an opted-in revoked device that proves possession of its paired key. Desktop verifies the response and stops at Pair again. A server without support for the signed response still presents a timeout if it silently refuses the join.
- Both Docker Electron tests passed, including an open-but-silent connection that recovers in the same document, retains the running shell, and leaves the second remote window connected. Pointer and keyboard Retry passed the contrast checks.
- All 14 hosted transport and Desktop integration tests passed. The actual Desktop connector received the signed refusal from a standalone server over direct signaling, and protocol checks rejected a wrong nonce, wrong device, wrong key, and forged signature. The legacy join received no refusal.
- The isolated packaged macOS app paired successfully and verified terminal input before arming the wake test. The nine-minute observation ended without a native suspend/resume event, so physical wake verification remains open.
