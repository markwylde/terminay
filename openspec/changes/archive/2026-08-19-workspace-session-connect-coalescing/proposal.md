## Why

The server-bundled workspace called `sessionHost.connect({ onStateChange })`, but the hosted
`connect` ignored those options. Recovery was an ad-hoc `recoverConnection` flag that the
*initial* connect did not set, so a `closed` event from a retiring bootstrap generation could
start a parallel connect that disposed the client which had just painted the terminal. After
that, an in-flight recovery flag could block further Retry if `connect()` hung.

## What Changes

- Treat workspace `connect` as acquisition of the session host's current generation rather than a
  second signaling join.
- Subscribe to the transport endpoint or session-host lifecycle after connect returns, and ignore
  `closed` and `failed` events from a retired generation.
- Make first mount, automatic recovery, and Retry share one in-flight attempt, with a bounded
  deadline for a hung attempt that returns to retry-wait.
- Drive the reconnecting UI from that attempt so a painted workspace whose client was disposed
  cannot remain marked connected.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: the mounted workspace shares the session host's current generation and has one
  coalesced connect attempt.

## Impact

`src/web/main.tsx` and the renderer connection controller. Depends on the hosted `terminay.com`
change that makes session `connect` use the current generation and publish lifecycle the
workspace can subscribe to.
