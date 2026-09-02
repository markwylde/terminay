## 1. Fail a silent hydrated generation

- [x] 1.1 Make `applyHostedLaneDiagnostic` fail the generation on
  `outbound-stalled` / `no-outbound` and on required-lane close (`application`,
  `control`, `terminal`, `assets`) while leaving handshake `api` / `asset` close
  alone, verified by
  `apps/terminay-server/test/hosted-hydrated-checkpoint-silence.test.mjs`
- [x] 1.2 Keep ICE `disconnected` while the peer stays `connected` as a consent
  blip, verified by the same suite

## 2. Recover from inbound silence

- [x] 2.1 Make `SessionConnectGate.shouldRecoverFromSilence` recover a ready
  attempt on `inbound-stalled` / `no-inbound`, with the workspace calling it,
  showing reconnecting, and replacing the generation, verified by
  `scripts/web-session-silent-pty-reconnect.test.mjs`
