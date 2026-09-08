## Context

A containerised server advertises candidates that a client on the same machine
cannot route to. Measured on this repository's own setup, with the server in a
podman container and the browser on macOS:

```
server host     10.88.1.72          macOS has no interface on 10.88.x
browser host    192.168.2.218       obfuscated as an mDNS .local name
server srflx    217.169.19.26:61984
browser srflx   217.169.19.26:56059  same public address, needs hairpinning
```

All three pairs are unusable, so ICE stays in `checking` and the peer closes
with no channels. This is not a Terminay defect: the server gathered and offered
correct addresses, and the client received them. There is simply no path.

`--network host` does not help. Docker and podman on macOS run containers inside
a Linux virtual machine, so host networking binds inside the VM.

One path does work, and was measured before this design was written: a published
UDP port. A container run with `-p 51000:51000/udp` received a datagram sent to
`127.0.0.1:51000` on the host, and its reply arrived back at the sender. So a
candidate naming the host-side address and that port is reachable.

In-force ADRs that constrain this: ADR-0011 (trust boundaries), ADR-0013
(host-approved pairing), ADR-0015 (direct exposure). None is revisited — this
changes which addresses a peer may try, not what authenticates it.

## Goals / Non-Goals

**Goals:**
- Desktop connects to a server in a container on the same machine.
- A server behind a port forward can be reached without a relay.
- Enabling it cannot remove a path that already worked.

**Non-Goals:**
- TURN. A relay would solve more cases, including symmetric NAT and same-NAT
  without hairpinning, but it carries user data through a third party and cuts
  against the data-blind hosted design. It is a separate decision.
- Discovering the reachable address automatically. The server cannot observe it;
  only the administrator who configured the forward knows it.
- Changing the direct exposure mode. This is about candidates, not signaling.

## Decisions

### D1. An additional candidate, never a replacement

The advertised address is added to the offer. Gathered candidates stay, in the
order they would otherwise have had.

The alternative — replacing gathered candidates when an advertised address is
set — was rejected because it makes the flag able to *break* a working
deployment. An operator who sets it on a server that was already reachable, or
sets it slightly wrong, would lose the paths that worked. As an addition, a
wrong value costs some failed connectivity checks and nothing else.

This also decides the failure mode when the value is wrong: ICE tries it, fails,
and falls back. Nothing hangs waiting for it.

### D2. The flag pins the ICE port

A candidate is only publishable if its port is known in advance. werift binds an
ephemeral UDP port by default, which cannot be named in a `-p` line.

So supplying an advertised address also pins `icePortRange` to that single port.
The two are one decision, not two flags: an address without a fixed port is not
forwardable, and a fixed port without an address does not help anyone.

Consequence: two servers on one host cannot both advertise the same port, and
the second fails to bind at startup. That is correct — they would be
advertising the same destination.

### D3. Literal addresses only

A hostname is rejected. An ICE candidate is a destination for a peer's
connectivity checks, and a name is resolved on the peer's machine, which may
resolve differently or not at all. The administrator forwarded an address; that
address is what belongs in the candidate.

### D4. Fail closed at startup

An unparseable address, an out-of-range port, or a port already bound stops the
server. The alternative — warn and continue with gathered candidates — was
rejected because the operator set the flag precisely because gathered candidates
do not work for them. Silently continuing produces the exact failure this change
exists to remove, with an extra log line nobody reads.

### D5. Wiring, not new machinery

`hostedPeerConfiguration` already takes a `hostAddresses` parameter that maps to
werift's `iceAdditionalHostAddresses`, and no caller passes it. This change wires
that parameter to configuration and adds `icePortRange` beside it. The
loopback-signaling branch above it is untouched.

### D6. It carries no authority

The advertised address is a routing hint. Host key pinning, the transport
transcript signature, the pairing URL, the session origin, and room admission
are all unchanged. A peer reaching the server over the advertised candidate
authenticates it exactly as over any other.

Worth stating explicitly because "advertise an address" sounds like it could
redirect a peer somewhere. It cannot: whatever answers on that address still has
to prove the host key, and a peer that cannot will be dropped before any
application data crosses.

## Risks / Trade-offs

- [An advertised `127.0.0.1` reaches a genuinely remote peer] → that peer sends
  connectivity checks to its own loopback, which fail ICE authentication. Noise,
  not a vulnerability; the runbook frames the flag as "for a server reachable
  only at a forwarded address", not a general knob.
- [Pinning a port makes startup fail where it used to succeed] → only when the
  port is taken, and only for a server whose administrator asked for that port.
  The failure names the port.
- [One port may not be enough if a future transport needs more sockets] →
  today's peer bundles onto one. If that changes, the flag accepts a range
  without a spec change to its meaning.
- [It looks like a fix for NAT generally] → it is not; it only helps where a
  reachable address and port exist and someone forwarded them. Documented as the
  container and port-forward case.

## Migration Plan

Additive and opt-in. Servers without the flag behave exactly as before. No
protocol change: an older client receives one more candidate and either uses it
or ignores it.

## Open Questions

- None blocking. Whether to offer a preset that sets the flag and the published
  port together is a documentation question, answerable after the runbook is
  written against the real flow.
