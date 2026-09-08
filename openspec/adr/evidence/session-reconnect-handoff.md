# Session reconnect hand-off evidence

The reported failure is that an installed PWA never recovers from a dropped,
intermittent, or backgrounded connection, while force-quitting and reopening it
always works. This run establishes where the recovery stops, against an
unmodified stack.

Date: 2026-09-08

## What was run

`terminay.com`, branch `repro/webrtc-reconnect`:

```sh
TERMINAY_REPRO_TRACE=/tmp/repro-trace.log \
TERMINAY_SOURCE=/path/to/terminay \
node --test --test-concurrency=1 --test-timeout=300000 \
  --test-name-pattern="dropped WebRTC generation" \
  specs/e2e/session-reconnect.test.mjs
```

The suite drives the real stack: hosted signaling over TLS with
`*.terminay.com` resolved to loopback, a real `terminay-server`, real Chromium,
real WebRTC, the real PWA, and the server's own workspace bundle from
`dist-web`. It pairs by match code, reaches a connected workspace, then closes
every live WebRTC lane. Two further scenarios inject an unreachable signaling
relay and a frozen-then-thawed document; all three fail identically.

## The generation that was never claimed

The session origin's lifecycle trace, one line per phase:

```
gen 1 -> connecting
gen 1 -> authenticating
gen 1 -> connected
gen 2 -> connecting
gen 2 -> authenticating
```

Generation 2 is the replacement built after the lanes were dropped, and it is
healthy. Its last lifecycle line, repeated for the rest of the run:

```json
{"type":"generation","generation":2,"peerState":"connected","iceState":"connected",
 "phase":"authenticating","inboundFrames":0,"outboundFrames":0,
 "inboundBytes":0,"outboundBytes":0,"droppedFrames":0}
```

All four required lanes opened on it — `control`, `application`, `terminal`,
`assets` — and the server reported one live generation with a healthy
application lane. Not one application frame crossed it in either direction.

`connected` is published only when a client acquires the generation's
application endpoint, so a generation parked at `authenticating` is a
replacement nobody claimed.

## What the workspace client did instead

While generation 2 was coming up, the workspace client reported:

```
__terminayServerClientState: "closed"
"Connection unavailable / Session transport closed during connect. / Retry connection"
```

The client observed its own transport die before the session origin retired the
generation, asked to reconnect, and `connect()` handed back the endpoint of the
generation that had just died. The client rejected that closed transport,
treated the single failed attempt as final, and stopped asking. The test waited
a further 60 seconds after generation 2 was healthy; nothing changed.

## Conclusion

The WebRTC lifecycle recovers. The hand-off between the replacement generation
and the workspace client does not, and the client does not retry, so the two
halves never meet again without a manual action.
