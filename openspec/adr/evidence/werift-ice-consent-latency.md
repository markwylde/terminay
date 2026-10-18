# Werift ICE consent on a slow path

Date: 2026-10-18
For: ADR-0006, and the `remote-access` requirement "Desktop observes transport
loss after connection establishment"

## Question

The real-WebRTC pairing test failed on `main` twice in a day: a Desktop
connection that nothing touched was closed while other windows of the same
device came and went. It failed only on a loaded CI host. Why does a connection
on loopback end at all?

## Finding

Werift 0.24.1 sends each ICE consent check once, with no retransmission
(`retransmissions` is `0`), and the STUN transaction gives up 50 ms later. On
the first check not answered in time it sets ICE `disconnected` and leaves the
consent loop with `break`. Nothing restarts the loop, and only a consent answer
sets ICE back to `connected`, so the path is reported lost for good while the
peer itself stays `connected`. Desktop ends a connection whose ICE stays
`disconnected` for 15 seconds, as the spec requires.

So any path whose consent answer takes more than 50 ms is closed about twenty
seconds after it connects. On the internet that is a path with more than 50 ms
of round trip. On a CI host that is loopback whenever the event loop is
starved for 50 ms, which is what happened on `main`.

RFC 7675 retransmits consent checks and expires consent only after 30 seconds
without an answer.

## Measurement

The scripts are in [`werift-ice-consent-spike/`](./werift-ice-consent-spike/).
They ran in `node:24-bookworm` with `--cap-add NET_ADMIN` and
`tc qdisc add dev lo root netem delay 40ms`: 80 ms of round trip on loopback.
Times are from the start of the script; ICE setup takes about ten seconds.

| Runtime | Path | Result |
| --- | --- | --- |
| Selected runtime, before this patch | no delay (macOS host) | stays `connected` for 40 s |
| Selected runtime, before this patch | 80 ms round trip | `connected` at 10.2 s, ICE `disconnected` at 15.6 s on both peers, never recovers; peers stay `connected` |
| Patched runtime | 80 ms round trip | stays `connected` |
| Patched runtime | 80 ms round trip, path cut for 12 s | ICE `disconnected` within 8 s of the cut, `connected` again at the next consent check, 0.4 to 6.8 s after the path returns (two runs) |
| Patched runtime | 80 ms round trip, path cut for good | ICE `disconnected` within 8 s; consent expires after about 40 s more |

When consent expires, Werift reports ICE `new` while the peer stays
`connected`. Neither the host nor Desktop treats `new` as recovery, so Desktop
has already ended the connection at 15 seconds and nothing changes for the host.

## Patch

`scripts/patches/werift-0.24.1-ice-consent-recovery.patch` gives each consent
check five retransmissions (50 ms doubling, about 3.1 s in all, less than the
shortest consent interval of 4 s), keeps checking after a miss so a later answer
reports ICE `connected` again, and reports `disconnected` once rather than on
every miss. Consent still expires after six missed checks in a row.

`scripts/secure-werift-ice-consent.test.mjs` runs against the staged artifact
and fails on the runtime before this patch.
