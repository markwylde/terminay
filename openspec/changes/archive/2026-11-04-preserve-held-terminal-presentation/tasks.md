## 1. Bounded presentation recovery representation

- [x] 1.1 Add a validated internal recovery value containing checkpoint state, geometry, safe position, head, and ordered output/resize tail; verify binary round-trip, size/position/format validation, and cross-session refusal in focused tests.
- [x] 1.2 Add canonical checkpoint seeding without synthetic PTY bytes or duplicate parsing; verify exact raw positions, split UTF-8/control sequences, ordered resizes, and explicit mouse tracking/encoding including disabled state.

## 2. Holder lifetime and protocol

- [x] 2.1 Retain shared bounded headless presentation from held-session spawn through detached output and resize; verify more than one ring of detached output and mode/buffer changes without any server-side refresh.
- [x] 2.2 Keep parser work, backpressure, failure, and cleanup independent from the live PTY stream; verify queue exhaustion/query replies never write to or end a PTY and disconnect releases only server-owned pause state.
- [x] 2.3 Negotiate protocol version 3 and transfer recovery in authenticated bounded binary chunks with an immutable cut and ordered live catch-up; verify fragmentation, malformed/oversized/truncated/session-mismatched transfers, concurrent output, and disconnect during preparation.
- [x] 2.4 Preserve frozen version 1/2 framing and raw attach semantics; run protocol and generation compatibility tests, including mutual proof and cross-build drain behaviour.

## 3. Server adoption

- [x] 3.1 Thread typed recovery through holder client/factory/reattach into terminal adoption; verify the same session/process identity, raw replay offsets, canonical geometry, and readiness before client hydration.
- [x] 3.2 Cache retained raw bytes already represented by recovery without interpreting them again or treating restoration bytes as activity/recordings/input; verify adoption, raw reads, presentation, and later live output agree and failure leaves the process running.

## 4. Regression and validation

- [x] 4.1 Make the existing long-history held-session recovery regression and its short-history control pass, preserving same-PID, keyboard redraw, DECRQM, and PTY wheel-counter assertions; run only through npm run test:e2e.
- [x] 4.2 Retain native focus/terminal switching/renderer reload and SGR/default-encoding mouse tests; run the focused mouse and holder relaunch/survival Docker suites and check ordinary shell selection/scrollback behaviour.
- [x] 4.3 Run focused server-core holder, checkpoint, adoption, security, and output-cost tests plus copied-holder runtime/packaging and TypeScript/build checks appropriate to changed modules; record results and resolve failures.
- [x] 4.4 Run openspec validate --all and openspec validate --all --archived, distinguish unrelated pre-existing failures, and verify git diff --check and the untouched main clone; leave the change unarchived until implementation is merged.
