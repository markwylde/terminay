## Why

A phone that loses its connection and gets it back now reaches a live
workspace — the tabs return, the project is there — and then the terminal it
came back for shows "Terminal presentation is unavailable because a complete
safe recovery boundary is no longer retained", with no way out short of killing
the app. While the connection was down the screen also flickered between
"Connecting to Terminay…" and "Reconnecting…" every few seconds. Both were
observed on an iPhone against the merged session reconnect hand-off fix
(`2026-09-08-fix-session-reconnect-handoff`); that fix made the connection come
back, which is exactly what exposed these two.

They are separate defects with one root: the previous change proved recovery
only for outages of a few seconds during which the shell printed nothing, and
only in desktop Chromium. A phone that is away for minutes while a shell keeps
printing, or that fails several attempts in a row, was never exercised.

- **The terminal dead end is a client fault against an existing spec.** After a
  reconnect the panel always resumes from the last position it rendered. When
  the shell printed more than the server's retained replay window while the
  phone was away, that position is behind the window, so the server — which
  correctly refuses to invent a screen — answers `presentation_unavailable`.
  The client then shows that as a terminal error and hides its own Retry
  button. The congestion-and-recovery spec already requires a reconnecting
  display to state its rendered position **or request a fresh presentation**,
  and requires a failed attempt to become a **retryable** error; the client
  does neither.
- **The flicker is the retry loop misreporting itself.** A failed attempt clears
  the connection record that the loop uses to decide whether it is recovering,
  so every attempt after the first is presented as a cold connect — the brand
  panel — and every failure as a reconnect — the error panel — and the error
  text is wiped between them.

## What Changes

- A terminal that is refused a resume because its rendered position is no
  longer retained treats that as a recoverable discontinuity, exactly as it
  treats a congestion skip: it re-attaches with a fresh presentation through
  the existing bounded, deadlined recovery loop, keeps the last completed
  display visible meanwhile, and ends hydrated. The dead-end error is shown
  only when a fresh presentation is itself unavailable, and it is retryable.
- The workspace session's recovery presents one steady reconnecting surface
  across every attempt. Whether the session is recovering is decided by whether
  it has ever been connected, not by whether a connection record currently
  exists; the last attempt's error stays visible until an attempt succeeds; and
  a single attempt no longer flips the phase on its own.
- The desktop's embedded server accepts a test-only override of its terminal
  replay window, gated on the existing E2E marker, so an end-to-end test can
  make a shell outrun the window during a real transport loss instead of
  hoping to.
- New regression coverage at every level: unit tests for the steady surface and
  the resume-refused classification; an Electron end-to-end test that loses the
  Local transport while a shell floods past the replay window and requires the
  same terminal session to come back hydrated and streaming; and the hosted
  session suite extended so its intermittent-relay scenario prints past the
  hosted replay window during the outage and asserts the surface never regresses
  to a cold connect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-stream-congestion-and-recovery`: **Post-reconnect restoration**
  and **Recovery never waits for PTY silence** gain the rule that a reconnect
  refused a resume from its rendered position requests a fresh presentation
  through bounded recovery rather than failing, and that a presentation
  unavailable outcome is a retryable error, never a dead end.
- `connections-and-client-hosts`: **Framed session liveness** gains the rule
  that recovery is presented as one steady reconnecting surface — recovering is
  decided by having ever connected, the last error stays visible across
  attempts, and no attempt regresses the surface to a cold connect.

## Impact

- `src/components/TerminalPanel.tsx` — handling of `presentation_unavailable`
  on a resume attach; retry actionability.
- `src/components/terminalPanelBindingFence.ts` — retry actionability rule.
- `src/web/main.tsx`, `src/web/sessionConnectAttempt.ts` — the recovery
  loop's recovering decision and phase/error ownership.
- `electron/main.ts`, `electron/serverTerminalAuthority.ts` — the E2E-only
  replay window override.
- `e2e/` — a new Electron end-to-end suite and fixture wiring for the
  override.
- `terminay.com` (separate repository, verification only) —
  `specs/e2e/session-reconnect.test.mjs` extended; no product change there.
- No server protocol change: `presentation_unavailable` and its payload are
  unchanged, and the server still never manufactures a screen.

## What this change does and does not prove

The verification is unit tests, the Electron suite in Docker, and the hosted
suite in desktop Chromium against a real server and real WebRTC. None of it
runs on a phone. The previous change said "ready" on the strength of desktop
emulation and was wrong on a phone; this one states its limit up front, and
the tasks name the on-device check as a separate, explicit step.
