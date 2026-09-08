## Why

A phone running the installed PWA connects perfectly on a cold start, but a
connection that drops — the network changes, the relay flickers, or iOS freezes
the app in the background — never comes back. The workspace shows
"Connection unavailable / Session transport closed during connect." and stays
there until the user force-quits the app and opens it again, which always
works. Every remote session on a mobile network eventually hits this, and the
only recovery a user has is killing the app.

The transport is not the problem. An end-to-end reproduction
(`terminay.com`, `specs/e2e/session-reconnect.test.mjs`, branch
`repro/webrtc-reconnect`) drives the real stack — hosted signaling, a real
`terminay-server`, real Chromium, real WebRTC, the real bundle — through the
three ways a phone loses a session: the WebRTC lanes dying, an unreachable
signaling relay, and a frozen-then-thawed document. All three fail identically,
and in each the session origin rebuilds a healthy replacement: a new peer
reaches `connected/connected`, all four required lanes open, and the server
reports one live generation. That replacement is then never claimed.

Two independent defects combine, and each alone is enough to strand the session:

- The session origin's `connect` hands the workspace the endpoint of the
  generation that just died. A generation is only discarded when the transport
  host retires it, but the workspace client notices its own dead transport
  first and asks to reconnect while the old generation is still the current
  one. `connect` sees a current, unretired generation, returns its already
  closed endpoint, and the workspace rejects it.
- The workspace client treats that one rejected attempt as final. It clears the
  connection, shows an error with a manual **Retry connection** button, and
  schedules nothing. The healthy replacement generation the session origin
  built moments later sits at `authenticating`, waiting for a client that has
  stopped asking.

## What Changes

- The session origin's reconnect operation stops handing out a dead transport.
  A generation whose application endpoint is already closed or failed is not a
  usable generation: `connect` replaces it and returns the replacement's
  endpoint, so a client that notices the loss before the transport host does
  gets the new generation rather than the corpse of the old one.
- Workspace recovery becomes persistent instead of single-shot. A failed
  recovery attempt schedules another one with bounded backoff, keeps the
  reconnecting state visible while it retries, and keeps retrying until it
  reconnects or the user leaves. **Retry connection** stays available and
  simply starts the next attempt now.
- Returning to the foreground re-checks liveness immediately rather than
  waiting for the next heartbeat interval to notice a transport that died while
  the document was frozen.
- The reproduction suite becomes the regression suite: the three fault
  scenarios move from proving the bug to proving the fix.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: **Framed session liveness** gains the
  reconnect hand-off contract — a recovery operation never yields a transport
  that is already closed — and the requirement that browser recovery retries on
  its own until it succeeds, rather than parking on a manual retry after one
  failed attempt.

## Impact

- `src/web/main.tsx` — the workspace session shell's connect gate, recovery
  scheduling, heartbeat, and reconnecting presentation.
- `src/web/sessionConnectAttempt.ts` — the connect gate and heartbeat that
  recovery scheduling builds on.
- `terminay.com` (separate repository) — `app/src/sessionTransportHost.js`
  `connect` and generation-usability check. The hosted session origin owns the
  WebRTC lifecycle, so the hand-off fix lands there; this repository owns the
  workspace client half and the contract both sides implement.
- `terminay.com` `specs/e2e/session-reconnect.test.mjs` — the existing
  reproduction, which must pass after the change.
- No protocol, server, or persistence change: no server, device, ticket, or
  archive behaviour moves.
