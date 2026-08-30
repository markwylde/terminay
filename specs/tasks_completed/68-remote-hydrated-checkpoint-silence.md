# Remote hydrated checkpoint silence

## Goal

A remote web session that paints a terminal checkpoint then stops streaming
live PTY must fail that generation, show an error, and reconnect. It must not
stay mounted as Connected.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)

## Why this is an active task

Tonight's Desktop diagnostics (`2026-08-30`) logged `outbound-stalled` and
required-lane `close` while `peerState=connected`. The workspace stayed on the
attach snapshot with no error and no reconnect. Existing tests encode the
Safari ICE consent blip and stall *logging*; they do not fail a silent
hydrated generation.

Failing tests:

- `apps/terminay-server/test/hosted-hydrated-checkpoint-silence.test.mjs`
- `scripts/web-session-silent-pty-reconnect.test.mjs`

## Scope

- [x] `applyHostedLaneDiagnostic` fails the generation on `outbound-stalled` /
  `no-outbound` and on required-lane close (`application`, `control`,
  `terminal`, `assets`). Handshake `api` / `asset` close does not.
- [x] ICE `disconnected` while the peer stays `connected` remains a consent blip.
- [x] `SessionConnectGate.shouldRecoverFromSilence` recovers a ready attempt
  on `inbound-stalled` / `no-inbound`. The workspace calls it, shows
  reconnecting, and replaces the generation.

## Definition of done

The two test files above pass. A painted checkpoint with no later PTY is not
left mounted as connected.
