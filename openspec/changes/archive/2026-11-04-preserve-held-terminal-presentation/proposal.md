## Why

A recovered long-running interactive terminal can keep accepting keyboard input and redrawing while clicks and scrolling stop reaching its program. The regression reproduces this after app relaunch: the holder retains the process and its last 1 MiB of output, but the one-time mouse, paste, focus, and alternate-screen setup has already been evicted. This proposal addresses that confirmed recovery failure; the originally reported macOS unlock/tab-switch trigger remains unconfirmed.

## What Changes

- Keep bounded, in-memory terminal presentation state with each held PTY, including while its server is disconnected.
- Restore a parser-safe presentation checkpoint and ordered output/resize tail before the recovered server admits live presentation. Preserve real PTY byte positions and the same running process.
- Add an internal holder protocol version for bounded binary presentation transfer; retain frozen older protocol behaviour and authenticate before sending any session data.
- Reuse the existing headless checkpoint implementation, explicit mouse-state serialization, bounds, and error semantics. Record an ADR superseding the holder's no-terminal-parsing restriction while preserving its remaining security, storage, runtime, and lifecycle commitments.
- Turn the failing long-history recovery test green and retain its short-history control, mouse/focus tests, and coverage for detached output, fragmented control sequences, mode changes, and legacy holders.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: Held-session recovery restores terminal presentation and input modes independently of retained raw history, without synthesizing PTY output or duplicating processes.
- `server-runtime-and-protocol`: State the holder-backed server-restart lifecycle and keep presentation recovery within the authenticated, bounded internal holder/server boundary.

## Impact

`packages/server-core/src/sessionHolder/{holder,protocol,client,factory,reattach}.ts`, terminal adoption/checkpoint types and initialization, corresponding server-core tests, the copied Windows holder runtime and packaging configuration, and Electron regression tests. No agent-specific configuration, renderer input interception, hosted storage, running-session disk journal, or application-protocol operation is introduced. Existing holders cannot retroactively recover state already lost from their raw rings; the new guarantee requires a holder generation that captured presentation from session creation.
