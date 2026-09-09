## Context

The session reconnect hand-off fix (`2026-09-08-fix-session-reconnect-handoff`)
made a lost connection come back. On a phone that had been away long enough
for its shell to keep printing, coming back revealed two further faults, both
observed on an iPhone against the merged build.

**The terminal dead end.** A terminal panel rebinds after a reconnect by
resuming from the exact position xterm last rendered (`TerminalPanel.tsx`,
`rebindServerAttachmentRef`: `fromPosition: renderedPositionRef.current`,
`freshPresentation: false`). The server retains a bounded replay window per
session — 4 MiB on the standalone server (`cli.ts`), 1 MiB on the desktop's
embedded server (`serverTerminalAuthority.ts` default) — and advances
`replayFrom` as older chunks fall out (`service.ts`). A resume whose requested
position is below `replayFrom`, with no prepared checkpoint, is answered with
`presentation_unavailable` (`protocol.ts`): the server never manufactures an
arbitrary byte suffix, which is correct and stays. The client renders that
event as a terminal error and `isTerminalRetryActionable(true)` returns
`false`, hiding Retry. The display is dead until the document reloads.

The client already owns a correct path for exactly this shape of problem. A
congestion skip enters `TerminalRecoveryController`, which — after
`prepareRecovery` retires the binding and keeps the last display painted —
re-attaches with `fromPosition: 0, freshPresentation: true, forceResume: true,
recovery: true`, bounded by a retry schedule and an attempt deadline. On the
server, `freshPresentation` waits for the checkpoint authority to settle and
prepares a parser-safe checkpoint at the head, then streams live output. That
is what a lost replay window needs; the panel simply never routes the refusal
there.

**The flicker.** `createRecoveryLoop` decides `recovering` by asking the host
whether a connection exists. `main.tsx` answers with `connectionRef.current !==
undefined`, and its `onAttemptFailed` clears that ref. So the first attempt
after a loss is `recovering: true` (overlay), every later one is `recovering:
false` — the cold-connect brand panel — and every failure returns to the
reconnecting error panel, with `setError(undefined)` wiping the text in
between. `connect()` itself also sets phase and clears the error at its start,
a second owner of the same state.

The boundaries this crosses: the terminal panel and the server's checkpoint
authority (ADR-0008 keeps the server the sole terminal authority; the client
only ever asks for a rendered position or a fresh presentation), and the
protocol-blind host contract (ADR-0012; nothing here widens what the session
origin exposes). No security boundary moves: a fresh presentation is the same
authorised attach the panel already performs on first mount.

## Goals / Non-Goals

**Goals:**

- A terminal refused a resume because its rendered position left the replay
  window recovers to a hydrated, streaming display with no user action, on
  the same terminal session, with the last completed display visible meanwhile.
- `presentation_unavailable` is never a dead end: when a fresh presentation is
  itself unavailable, the error is retryable and Retry asks for a fresh
  presentation.
- The workspace recovery surface is steady across repeated failed attempts:
  reconnecting, with the last error visible, never a cold-connect panel.
- Regression coverage at unit, Electron end-to-end, and hosted end-to-end
  levels that specifically outrun the replay window during a transport loss
  and specifically fail several attempts in a row.

**Non-Goals:**

- No change to what the server retains or how it decides a resume is
  refusable. The bounded window and the refusal are correct.
- No new protocol event or field. `presentation_unavailable` and its payload
  (`requestedFromPosition`, `replayFrom`, `outputPosition`) are unchanged.
- No second recovery mechanism in the panel. The refusal joins the existing
  controller rather than adding a parallel retry loop.
- No claim of on-device verification. This design is verified in Chromium and
  Electron; the on-device check is a named, separate task.

## Decisions

### A refused resume is a discontinuity, routed into the existing recovery controller

When the initial events of a **resume** attach contain
`presentation_unavailable`, the panel synthesises a skip covering
`requestedFromPosition → outputPosition` and offers it to
`TerminalRecoveryController.noteEvent`. Everything after that is the proven
congestion path: `onRecoveryStarted` runs `prepareRecovery` (binding retired,
attachment left in place so the lease survives, last display kept painted),
the schedule fires `requestRecoveryAttach`, and the fresh attach hydrates from
a checkpoint at the live head. The controller's attempt deadline and retry
schedule bound it; a display that keeps printing is covered by the existing
"never waits for PTY silence" behaviour.

The synthetic skip carries `reason: 'attachment_closed'` — the existing
recoverable reason for "the lane that was serving you is gone" — so
`isRecoverableSkip` admits it without a new reason value and diagnostics stay
content-free. The panel records the classification as a diagnostic so the
Electron suite can prove the fresh path was taken rather than a coincidental
congestion recovery.

*Alternative considered:* rebind with `freshPresentation: true` always.
Rejected — a fresh presentation costs a checkpoint settle and a full
restoration on every reconnect, and it discards a resume that would have been
exact. The refusal is the right signal: it is the server saying, from
authority, that resume is impossible.

*Alternative considered:* add a client-side check against `replayFrom` before
asking. Rejected — the client does not know `replayFrom` until it asks, and
guessing reintroduces exactly the "remembered cursor" the spec forbids.

*Alternative considered:* on refusal, call `attachServerTerminal` fresh directly
from the event handler. Rejected — that bypasses the controller's schedule,
deadline, and single-recovery invariant (spec: single recovery controller and
input safety), and would race a congestion skip arriving in the same window.

### `presentation_unavailable` on a fresh presentation is a retryable error

If the attach that produced `presentation_unavailable` was itself fresh, no
better request exists; the error is shown and stays retryable. The retry action
for this state requests a fresh presentation (position zero) rather than a
resume from a position the server has already refused.
`isTerminalRetryActionable` therefore no longer hides Retry for
`presentationUnavailable`; the only non-actionable states are a terminal that
has exited or was interrupted, which are already handled separately.

### Recovering means "has ever connected", and the loop owns phase and error

The recovery loop remembers that an attempt has succeeded and reports
`recovering: true` from then on, regardless of what the host's `recovering()`
says in the moment — the host's answer is only consulted before the first
success. That keeps the rule where it is unit-testable without a renderer. In
`main.tsx`, `onAttemptStart` no longer clears the error (the last error stays
until success), and `connect()` no longer sets phase or clears error at its
start — the loop's callbacks are the single owner of both. On success the
connection is published, phase becomes `ready`, and the error clears.

*Alternative considered:* keep the memory in the host as a ref and leave the
loop a pure scheduler. Rejected — it puts the one rule that failed inside a
React component that has no unit test, which is how it shipped wrong.

### An E2E-only replay window override on the desktop's embedded server

The Electron end-to-end suite needs the shell to outrun the replay window
during a Local transport loss. Local recovery completes in well under a second,
so a 1 MiB window cannot be outrun deterministically by real output in that
gap. `electron/main.ts` reads `TERMINAY_TEST_TERMINAL_REPLAY_BYTES`, honoured
only when `TERMINAY_TEST=1` is also set — the same gate and shape as
`embeddedWorkspacePersistenceFault` — and passes it as `maxReplayBytes`. A
production process ignores the variable entirely. `e2e/fixtures.ts` sets it for
the new spec file only.

*Alternative considered:* rely on the client's rendered position lagging under
a flood. Rejected — non-deterministic, and it proves congestion recovery, not
the refused resume.

### Verification is layered, and its limit is stated

- Unit: the loop's steady surface across repeated failures; the refused-resume
  classification (a resume's `presentation_unavailable` becomes a skip; a fresh
  attach's does not).
- Electron (Docker, `npm run test:e2e`): seed a marker, start a sustained
  flood, fail the Local transport, and require the same session id to come
  back as one panel, hydrated, with a fresh-presentation recovery diagnostic
  recorded and new output streaming after the flood is stopped.
- Hosted (`terminay.com`, run locally against this build): the
  intermittent-relay scenario prints past the 4 MiB window during its outage
  and asserts the surface never shows the cold-connect heading after first
  connect; all three scenarios still pass.
- Not verified: any phone. The tasks carry that as an explicit step for the
  owner.

## Risks / Trade-offs

- **A synthetic skip could be mistaken for real congestion in diagnostics.** →
  The panel records a distinct diagnostic (`presentation-refused`) alongside the
  controller's `recovery_started`; the Electron suite asserts on it.
- **Routing into the controller while a congestion skip arrives in the same
  attach.** → `noteEvent` ignores events while already `recovering`, and the
  fresh attach it schedules covers both gaps; this is the existing "redundant
  skip" behaviour.
- **A fresh presentation on a terminal that never falls silent.** → Bounded by
  the existing settle deadline and catch-up limit on the server (spec: bounded
  checkpoint catch-up); the client keeps the last display visible and retries
  on the existing schedule.
- **The E2E override is a production code path.** → Ignored unless
  `TERMINAY_TEST=1`; validated as a positive safe integer; no other behaviour
  keyed on it.
- **Steady surface hides a permanent failure.** → Unchanged from the previous
  change: unrecoverable classes stop retrying and present terminally; the
  visible error text now persists rather than blinking.

## Migration Plan

No data, protocol, or persisted state changes. The client half ships in the
server bundle; the desktop half ships with the desktop. Rollback is reverting
the change. The hosted repository needs no product change; its suite extension
is verification.

## Open Questions

- Whether the desktop's 1 MiB embedded replay window should match the
  standalone server's 4 MiB is a product question outside this change; the
  override does not alter either default.
- No in-force ADR needs revisiting. ADR-0008 (server as sole terminal
  authority) and ADR-0012 (protocol-blind framed host) already bound this, and
  the change stays inside both.
