## Why

A remote web session could paint a terminal checkpoint and then stop streaming
live PTY output while staying mounted as Connected, with no error and no
reconnect. Desktop diagnostics on 2026-08-30 logged `outbound-stalled` and a
required-lane `close` while `peerState=connected`, and the workspace simply sat
on the attach snapshot.

## What Changes

- Make `applyHostedLaneDiagnostic` fail the generation on `outbound-stalled` and
  `no-outbound`, and on the close of a required lane (`application`, `control`,
  `terminal`, `assets`). A handshake `api` or `asset` close does not fail it.
- Keep an ICE `disconnected` while the peer stays `connected` as a consent blip.
- Make `SessionConnectGate.shouldRecoverFromSilence` recover a ready attempt on
  `inbound-stalled` and `no-inbound`; the workspace calls it, shows reconnecting,
  and replaces the generation.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: a generation that hydrates a checkpoint but cannot deliver
  later events is failed rather than left connected.

## Impact

The hosted lane diagnostic path, `SessionConnectGate`, the workspace connection
surface, `apps/terminay-server/test/hosted-hydrated-checkpoint-silence.test.mjs`,
and `scripts/web-session-silent-pty-reconnect.test.mjs`.
