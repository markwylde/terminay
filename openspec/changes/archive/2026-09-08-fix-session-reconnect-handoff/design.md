## Context

A framed PWA session has two halves either side of one narrow boundary. The
session origin (`terminay.com`, `app/src/`) owns the WebRTC lifecycle: it joins
signaling, verifies the authenticated transport transcript, opens the required
lanes, and publishes exactly one sealed contract to the page. The workspace
client is the server-bundled UI in this repository (`src/web/main.tsx`), and the
only thing it may ask for across that boundary is `connect()` — an opaque byte
transport, plus a state callback. ADR-0012 fixes that split, and ADR-0008 keeps
the host protocol-blind: the client cannot see peers, lanes, or generations, and
the session origin cannot see the application protocol.

That boundary is exactly where recovery breaks. Both halves can observe a dead
connection, and they observe it at different times through different signals.
The session origin watches peer and lane state. The workspace client watches its
own protocol traffic and a liveness heartbeat. When a phone loses its
connection, the client's evidence usually arrives first: the application lane
stops answering before ICE has given up and before the lane's `close` event
fires.

The reproduction (`terminay.com`, `specs/e2e/session-reconnect.test.mjs`) shows
what follows. The client asks to reconnect while the session origin still
considers the dying generation current. `connect()` finds a current, unretired
generation and returns its endpoint — the very endpoint the client just watched
die. The client rejects a closed transport, reports "Session transport closed
during connect.", and stops. Moments later the session origin's own detection
fires, it builds a healthy replacement, and that replacement reaches
`authenticating` and stalls there forever, because the phase past it is only
published when a client claims the generation's application endpoint, and the
only client has given up.

The reproduction's phase trace is the evidence: generation 2 reaches
`peerState: connected`, all four required lanes `open`, one live generation on
the server — and never leaves `authenticating`.

## Goals / Non-Goals

**Goals:**

- A reconnect request never resolves with a transport that is already closed or
  failed, no matter which side of the boundary noticed the loss first.
- Browser recovery is persistent: it keeps attempting until it reconnects or
  the user leaves the session.
- Returning to the foreground proves liveness immediately rather than waiting
  out a heartbeat interval.
- The three reproduction scenarios pass as regression tests.

**Non-Goals:**

- No change to pairing, device enrollment, host approval, transcript
  verification, tickets, or the archive install path. Recovery reuses the
  installed bundle and the vaulted device key exactly as it does today
  (ADR-0013).
- No widening of the session host contract. The workspace client still receives
  only `connect()` and a coarse `closed`/`connecting`/`live` state; it does not
  learn about peers, lanes, or generations (ADR-0008, ADR-0012).
- No new transport, no ICE restart mechanism, no change to the WebRTC runtime.
- No unbounded retry that keeps a hopeless session hammering signaling.

## Decisions

### The reconnect operation owns generation usability, not just retirement

`connect()` currently treats "a current generation exists and is not retired" as
"a usable generation exists". Retirement is driven by the session origin's own
detection, so between the client noticing the loss and the session origin
noticing it there is a window in which the current generation is dead but not
yet retired. Every failure in the reproduction lands in that window.

The fix is to make the endpoint's own state part of the usability test: a
generation whose application endpoint is closed or failed is not usable, and a
`connect()` that finds one requests a replacement and returns the replacement's
endpoint. This keeps the decision on the side that owns the WebRTC lifecycle,
and it needs no new information to cross the boundary.

*Alternative considered:* let the workspace client retry `connect()` until it
receives an open transport. Rejected — it makes the client poll across the
boundary for a condition the session origin can answer authoritatively, and it
still returns a dead transport on the first call, so every recovery pays an
avoidable round of failure. It is also strictly weaker: a client that gives up
for any other reason still strands a healthy generation.

*Alternative considered:* have the client tell the session origin "this
transport is dead, replace it". Rejected — that is a new verb on a deliberately
narrow contract, and it lets untrusted client code force generation churn.

### Recovery retries with bounded backoff instead of stopping at the first failure

The workspace client's connect gate admits one attempt at a time and treats a
failed attempt as terminal: it clears the connection, surfaces the error, and
waits for a person. That is the second half of the bug, and it is independently
fatal — a first attempt can fail for reasons that have nothing to do with the
hand-off (a relay that is briefly unreachable, a host that has not re-registered
yet, a bootstrap that outran its deadline), and the app must survive all of
them.

Recovery therefore schedules a further attempt after a failure, with bounded
exponential backoff and jitter, and stays in the reconnecting state while it
does. The existing single-flight gate still prevents concurrent attempts, and
the existing generation check still retires the results of superseded ones.
**Retry connection** remains, and now means "attempt now" rather than "attempt
at all".

The backoff is bounded, not infinite in rate: attempts grow from roughly a
second to a ceiling in the tens of seconds and continue at that ceiling. A
session that cannot reach its server holds one slow attempt loop, which is what
a user who put their phone down and picked it up an hour later needs, and it is
the same shape as the retry the session origin already performs when it is
offline.

*Alternative considered:* a fixed small number of retries, then stop. Rejected —
it reproduces the reported failure on any outage longer than the attempt budget,
which is exactly the case that matters on a mobile network.

### Foreground proves liveness immediately

A frozen document runs nothing, so on thaw the client's heartbeat is mid-interval
and its transport may already be dead. Waiting for the interval, and then for a
miss limit, delays recovery by tens of seconds and is a large part of why
returning to the app feels broken even when recovery eventually works.

On becoming visible the client probes liveness at once and, if the probe fails,
enters recovery immediately. This is the client-side counterpart of the session
origin's existing resume handling, and it changes no state on its own — an
answered probe is a no-op.

### The reproduction suite becomes the regression suite

The three scenarios already drive the real stack end to end, and their fault
injection is test-only instrumentation installed before page scripts. They stay
where they are, in the repository that owns the hosted session origin, and the
change is complete only when they pass.

## Risks / Trade-offs

- **A retry loop against a server that is genuinely gone burns battery and
  signaling capacity.** → Backoff is bounded with a ceiling in the tens of
  seconds, and attempts pause while the document is hidden, so a backgrounded
  phone is not looping.
- **Persistent retry can hide a real, permanent failure behind a spinner.** →
  The reconnecting state keeps showing the last attempt's error, and errors that
  cannot be recovered by retrying — a revoked or missing device identity, a
  host-key mismatch — keep their existing terminal presentation and are not
  retried.
- **Replacing a generation on a closed endpoint could churn generations if a
  client asks repeatedly during a bad network.** → Replacement is already
  coalesced into a single in-flight operation on the session origin, so
  concurrent requests join one replacement rather than starting several.
- **The fix spans two repositories, so a half-deployed pair is possible.** →
  Each half is independently an improvement and neither depends on the other to
  be safe: a client that retries survives a session origin that still hands back
  a dead transport (it simply costs an extra attempt), and a session origin that
  never hands back a dead transport helps a client that only tries once. The
  reproduction suite runs both halves together and is the gate.
- **Backoff makes recovery timing less predictable in tests.** → Attempt
  scheduling stays injectable, as the connect gate's clock already is, so tests
  drive it deterministically.

## Migration Plan

No data, protocol, or persisted state changes, so there is nothing to migrate
and no compatibility window. The workspace client half ships in the server
bundle and reaches a session the next time it installs a bundle; the session
origin half ships with the hosted surfaces. Rollback is reverting either half
independently.

## Open Questions

- Should recovery attempts pause entirely while the document is hidden, or
  continue at the backoff ceiling? Pausing saves battery and matches how iOS
  freezes the document anyway; continuing means a session that is briefly hidden
  reconnects sooner. The design assumes pausing, with the immediate probe on
  becoming visible as the compensation.
- No in-force ADR needs revisiting. ADR-0008 and ADR-0012 already assign the
  WebRTC lifecycle to the session origin and keep the host protocol-blind, and
  this change stays inside both.
