# Terminal synchronization fixes — verification

1 November 2026. The initial audit used `c9bf02a8`; implementation began from `002f2c2a` and is rebased onto current main before submission. No accepted ADR or main-clone product file is edited.

## Independent review

The owner requested `claude -p`. Two read-only CLI reviews are retained here:

- [Audit review](./claude-review.md): confirms the principal findings, identifies the implemented but unarchived handoff tradeoff, corrects the current holder ADR to ADR-0086, and distinguishes adapter admission from end-to-end PTY backpressure.
- [Implementation review](./claude-implementation-review.md): identifies overflow/interruption state interactions, current-attachment failure classification, large request bursts, and ledger cleanup risks.

The implementation addresses the second review as follows:

1. Unknown-outcome handoff clears overflow pause, discards successors, and resumes only on a hydrated controller; notice dismissal cannot leave a hidden pause.
2. Overflow discards pending input without advancing attachment generation, so current-attachment failures still reach transport recovery.
3. SDK admission caps outstanding feature requests at 128 and captured bytes at the negotiated byte budget, with bounded local FIFO admission. A 600-request burst remains connected. Heartbeat/cancellation bypass feature admission. Unsent requests are cancelled on disconnect and cannot cross generations.
4. Ledger completion and pending-count cleanup run in `finally`, including unexpected registry errors; conflicting command identity reuse is rejected and replay never reapplies output credit.
5. Production `TerminalService` single-write limit is 64 KiB; adapter pending-byte limit is 256 KiB. No production override increases the single-write limit, so routing production callers through it introduces no smaller single-write allowance. App-window text has a separate 16 KiB limit. This is pending admission, not proof of shell consumption.

The unarchived handoff proposal/design/delta is amended to agree with the input safety contract. Existing successful and definitively refused handoff preservation remains tested.

## Automated checks

- Server-core suite: **1,740 passed, 5 skipped, 0 failed** (1,745 tests).
- Protocol/client/renderer/recording selected suites: **429 passed, 0 failed**.
- Actual standalone WebSocket transport integration: **2 passed**.
- Shared/application builds and root TypeScript check: passed.
- Workspace type checks: **27 jobs passed**.
- Repository lint: passed with existing repository diagnostics. Changed code is linted separately.
- OpenSpec: the new change and amended handoff change pass strict validation; all capabilities/changes validate without errors.

The first full-suite run exposed two stale renderer fixtures on the baseline too: missing `Lock` icon stubs and the old boolean retry-helper signature. They are updated to the current implementation. A shell-profile test expecting different payloads to share a command identity is updated to assert identical-request replay and conflicting-request rejection.

Containerized E2E: **43 passed without retries** under the repository-default single-worker configuration, covering input handoff, visible overflow and continuation, parser-safe presentation recovery, replay-window recovery, terminal hydration, recording, macros and background responsiveness. Full CI results are recorded in the pull request; no host Electron suite is run. A two-worker run required retries for macro dragging and high-output terminal input; the serial configuration matches repository defaults. Main's separately merged input-stability helper changes are incorporated before submission.

The standalone WebRTC pairing test passed its unavailable-runtime fail-closed case. That is not a fresh real-network WebRTC interoperability proof. Local/remote protocol conformance and real WebSocket transport are tested; supported-platform native release probes and full E2E run in CI.

## Performance evidence

[Benchmark source](./benchmark.mjs) calls production methods from the baseline and changed worktrees, interleaves five trials, and retains [raw native results](./native-benchmark.json). Node 24.15.0, no artificial CPU throttle.

| Workload | Baseline median | Changed median |
| --- | ---: | ---: |
| Small terminal frame encode/decode | 9.262 µs | 8.261 µs |
| Terminal input dispatch, including steady-state ledger eviction | 2.733 µs | 4.899 µs |
| Holder append, 1 MiB initially in 4 KiB chunks | 0.062 µs | 0.045 µs |
| Holder append, 1 MiB initially in 16-byte chunks | 9.484 µs | 0.053 µs |

Codec improves approximately 11%; fine-chunk holder retention improves approximately 180× **for that isolated operation**. Stronger command fingerprinting/deduplication adds about 2.2 µs per native dispatch. These numbers do not establish an end-to-end typing speedup, nor do they predict browser-VM latency. Existing holder generations keep their code; retention improvement reaches newly created generations.

The existing native repaint harness ran a real PTY and embedded authority for five seconds with a full replay window. [Baseline](./baseline-native-repaint.json): 3.6% process CPU, 16,569 bytes/s. [Changed](./changed-native-repaint.json): 3.2%, 16,464 bytes/s. This short check shows no observed CPU regression at comparable output throughput; the difference is too small/brief to claim a sustained application-wide improvement. It does not include a real display or the holder's separate process.

The acknowledgement coalescer deterministically turns 100 interactions during one outstanding acknowledgement into one initial and one trailing request per session/kind. Activity and agent kinds remain independent; quiet typing can still send both. Passive acknowledgements and stream acknowledgements are unchanged.

## Deliberately separate architectural work

Screen preservation across server replacement is not solved here. A bounded raw suffix lacks prior terminal modes, cells, parser state and resize history; preserving a process does not preserve a screen. Correct continuity needs an authoritative presentation and its complete ordered output/resize tail to survive together, with a new architectural decision coherent with ADR-0086 and frozen holder generations. Adding another emulator or unbounded history without resource and state-equivalence proof would undermine this change's reliability/performance goals.

Output ordering, exact attachment identities, presentation ownership, canonical checkpoints, cumulative output acknowledgements, fair output scheduling and congestion recovery remain intact.


## Final Claude review follow-up

The final read-only review is retained in `claude-final-review.md`, with disposition. Confirmed fixes add distinguishable unsent connection loss, consistent cancellation, early holder configuration validation, and readiness-aware interruption notices. No uncertain input replay or output acknowledgement behavior changed.

Follow-up verification (2026-11-01):
- Client suite plus admission/recording/queue regressions: 299 passed.
- Project-creation recovery: 16 passed.
- Holder suites: 115 passed.
- Containerized `terminal-input-handoff.spec.ts`: 2 passed, one worker, zero retries.
- All 27 workspace type checks and root `tsc --noEmit`: passed.
- Lint passed with existing warnings; OpenSpec all 99 items passed; strict change validation passed.
- Actual SDK/renderer tests prove unsent input resends once after handoff and abort after admission grant sends no frame. Pending and read-only notices cannot continue until a controller attachment is ready.


## Resumed review closure

Claude's saved session reviewed the final cleanup and notice fixes and reported no actionable defects; both rounds are retained in `claude-closure-review.md`. One cause-aware classifier now serves SDK subscription teardown, file-observation cleanup, workspace teardown and project recovery. Generic unavailable/forbidden failures still propagate. Read-only observers hide retained interruption notices and restore them on gaining control; closing the queue clears its notice.

Verification: 301 client/admission/input tests and 16 project recovery tests passed; containerized handoff E2E 2/2 passed without retries. All 27 workspace type checks, root type check, lint and OpenSpec validation (99/99) passed. Added the optional review test for an unknown write settling after a read-only replacement, proving it remains hidden until control returns and ambiguous input is never replayed.
