## Why

With one terminal running a full-screen TUI — Claude Code over `ssh`, `htop`,
a spinner-heavy build — Terminay becomes the top energy consumer on the
machine. The main process holds 30–45% of a core for as long as the TUI is on
screen, and the host runs `ps` over its whole process table about forty times a
second. Nothing is wrong on screen, so the only symptom the user gets is a warm
laptop and a short battery.

The cost was reproduced by driving the production embedded composition with a
deterministic repaint loop (~315 output chunks a second, replay full): **32.4%
main-process CPU and 41.7 `ps` spawns per second**. Switching off three pieces
of per-chunk work, one at a time, accounts for almost all of it:

| Configuration | Main CPU | `ps`/s |
| --- | --- | --- |
| As shipped | 32.4% | 41.7 |
| Without the authority's per-event replay rebuild | 11.3% | 41.9 |
| …and with a running replay byte total | 9.5% | 38.9 |
| …and without a host sample per output chunk | 2.7% | 0.7 |

Each of the three does work per output event that is proportional to something
other than the event: the megabyte already retained, the number of chunks
already retained, or the size of the host process table. A TUI turns that into
a constant load because it never stops printing. Full method and figures are in
`openspec/adr/evidence/terminal-output-main-process-cost.md`.

## What Changes

- Retaining an output event costs the size of that event. The desktop
  authority's recent-output buffer and the terminal service's replay both keep
  their bound with a running byte total and constant-time eviction, instead of
  rebuilding or re-summing what is already retained. What is retained, how much,
  and for how long are all unchanged.
- Recent output is assembled into one contiguous value only when something
  reads it (AI tab metadata, an AI replay, a reopened project), not on every
  event.
- Output-driven foreground observation is paced by time. Output after a quiet
  period still refreshes the foreground projection at once; sustained output
  then goes behind the shared damping ramp that already fronts other
  change-driven work (ADR-0028): at most one host sample per ramp interval,
  with output inside an interval collapsing into one sample at its end.
- Destructive-close observation is untouched: it still obtains a fresh sample
  for its addressed session immediately, never waits on output pacing, and the
  interval that covers silent foreground processes stays.

Not in this change, because the measured remainder after the three fixes is
2.7% CPU at a *higher* chunk rate (443/s): presentation checkpointing in a
headless xterm, per-listener event copies, activity-detector timers, holder
frame coalescing, and diagnostic envelope decoding. They work, they are
bounded, and rewriting them would risk the stream-recovery behaviour for no
measurable return.

Reported alongside but separate: recordings decode each chunk with a fresh
non-streaming `TextDecoder`, so a multi-byte character split across two chunks
is recorded as replacement characters. That is a correctness defect in the
`recording` capability with its own tests and belongs in its own change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: `Session-owned bounded foreground observation`
  gains a rate bound — sustained output causes at most one host sample per
  shared-ramp interval per session — while keeping prompt refresh after quiet
  and settlement without silence.
- `terminal-stream-congestion-and-recovery`: `Server continues consuming PTY
  output` gains a cost bound — the work to retain an output event is
  proportional to that event, independent of how much output, or how many
  chunks, are already retained.

## Impact

- `electron/serverTerminalAuthority.ts` — `handleEvent` and the three readers
  of `buffers` (`getBuffer`, `aiReplay`, `generateAiMetadata`).
- `packages/server-core/src/terminalService/service.ts` — `appendOutput`,
  `replayBytes`, and the replay readers.
- `packages/server-core/src/terminalService/nodePty.ts` —
  `createForegroundObserver`, `createForegroundPolling`, and the per-chunk
  `foreground.poll()` in the in-process PTY path.
- `packages/server-core/src/sessionHolder/factory.ts` — the same per-chunk
  `foreground.poll()` on the session-holder path, which is the one the packaged
  desktop app runs.
- Tests: four failing reproductions are already on this branch
  (`packages/server-core/test/terminal-replay-cost.test.mjs`,
  `packages/server-core/test/session-holder-foreground-rate.test.mjs`, two
  cases in `packages/server-core/test/node-pty-adapter.test.mjs`,
  `scripts/server-terminal-authority-output-cost.test.mjs`), with passing
  guards beside them for the behaviour that must survive.
- `package.json` — `test:server-terminal-runtime` is not reached by `smoke` or
  any CI job today, so the authority tests gate nothing until that is wired.

No protocol, persistence, or settings change. Replay bounds, replay contents,
and close-protection semantics are identical before and after.
