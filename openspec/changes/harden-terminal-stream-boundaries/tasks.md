## 1. Recording and output-path cost

- [x] 1.1 Add active-recording byte decoding and route production observers through it; verify multibyte splits, finalization and recording lifetime isolation.
- [x] 1.2 Replace holder array eviction with an equivalent bounded queue; verify random retention/replay equivalence, oversized last-chunk retention, scaling and before/after measurements.
- [x] 1.3 Validate canonical JSON once per public boundary and serialize privately; verify byte-identical corpus, malformed/deep input rejection and before/after codec measurements.

## 2. Input continuity and admission

- [x] 2.1 Separate unknown-outcome handoff interruption from successful/refused handoff; verify queued successors and paste are discarded, notice is visible, and a hydrated replacement accepts new input.
- [x] 2.2 Bound aggregate retained paste data and expose overflow without failing output; verify ordinary overflow, repeated large paste, Stop/accounting and renderer notice controls.
- [x] 2.3 Compose and route one attributed input adapter across protocol, macros, dictation, automation, app-window messages and host writes; verify production composition routing and competing-source order without claiming PTY-consumption backpressure.

## 3. Connection command handling

- [x] 3.1 Deduplicate in-flight and retained commands with request fingerprints and per-attempt correlation; verify conflicting reuse, duplicate cancellation and one execution of terminal delivery side effects.
- [x] 3.2 Add a bounded feature FIFO while continuing control admission; verify saturated heartbeat, active/queued cancellation, FIFO order, original deadlines, termination and safety-ceiling closure.
- [x] 3.3 Coalesce interactive activity/agent acknowledgement bursts independently; verify one in flight plus one trailing per session/kind and unchanged quiet/passive behavior.

- [x] 3.4 Bound SDK request bursts before transmission; verify a 600-request burst, byte budgets, cancellation, deadlines, captured payload/body ownership and pre-send disconnect classification.

## 4. Verification and review

- [x] 4.1 Reconcile cursor comments/spec deltas and retain Claude's review plus qualified performance evidence; verify OpenSpec validation and report links.
- [x] 4.2 Run affected builds, type/lint checks, focused protocol/runtime/renderer tests and containerized terminal E2E; fix regressions and record exact results.
