## Why

A remote generation that dumps a hydration checkpoint and then pauses its
outbound lane while handshake inbound continues was being failed as
`outbound-stalled` and closed, forcing an unnecessary reconnect.

## What Changes

- Fail `outbound-stalled` only when the first unacknowledged outbound frame is
  older than the hydrate grace period of 15 seconds.
- Classify peer-closed `outbound-stalled` and required-lane close explicitly, so
  the Desktop close reason names the stall rather than falling through to
  `other`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: outbound stall detection during hydration and the
  classification of peer-closed reasons.

## Impact

Remote generation stall detection and the Desktop peer-closed reason
classification. Covered by
`hosted-hydrated-checkpoint-silence.test.mjs`.
