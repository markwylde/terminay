# Container reachability without an advertised address

Date: 2026-10-03. Host: macOS (Darwin 27.0.0, arm64), podman 6.0.2, libkrun
machine, netavark, user-mode networking. Host LAN address `192.168.2.218`,
firewall disabled. Server: `main` channel, revision `9497f228b72d`.

## Question

Does a Terminay Server in a local container need `--advertise-address` and a
published UDP range for a client on the same machine to connect?

## What the container can see

| Lookup inside the container | Result | Usable by a client on the host |
| --- | --- | --- |
| Own interface | `10.88.0.88` | No — exists only inside the VM |
| `host.containers.internal` | `192.168.127.254` | No — VM-internal gateway |
| STUN | the router's public address | Only with router hairpinning |

The host's LAN address is not observable from inside the container.

## Outbound UDP from the container

A UDP echo on the host, a datagram from the container:

| Destination | Reply received | Source the host saw |
| --- | --- | --- |
| `192.168.2.218:47999` | yes | `192.168.2.218:55798` |
| `192.168.127.254:47999` | yes | `127.0.0.1:62657` |

The container can open a UDP path to the host's LAN address.

## Browser, advertised address (container `terminay`)

Published `8443/tcp` and `51000-51003/udp`; `--advertise-address
192.168.2.218:51000`. Firefox 156 paired through `app.terminay.com` and held a
terminal session. Server pairing-scope pair: `localType=host`,
`remoteType=prflx` — the browser reached the forwarded port, and the server
learned of it only from that packet.

## Desktop code, no advertised address (container `terminay-test`)

Published `9443/tcp` only. No UDP port, no advertised address,
`--direct-origin https://localhost:9443`. A Node script on the host bundled
`electron/remote/desktopHostedConnection.ts` and called
`pairDesktopHostedDevice` then `connectDesktopHostedRemote` with default ICE
servers, approving through `terminay-server approve` in the container.

| Signaling | Paired | Session connected | Held 25 s | Desktop's pair |
| --- | --- | --- | --- | --- |
| Hosted (`app.terminay.com`) | 1922 ms | 306 ms | yes | `host` / `prflx` |
| Direct (`https://localhost:9443`) | 1797 ms | 196 ms | yes | `host` / `prflx` |

Server device-scope pair: `localType=host`, `remoteType=host`. The server
dialled Desktop's real address; Desktop saw the server as peer-reflexive.

## A pinned ICE range is a budget across peers

Peers were opened one after another against the selected werift runtime, each
kept alive, all confined to one pinned range, on the macOS host (one IPv4 and
four IPv6 addresses):

| Pinned range | First peer | Second peer |
| --- | --- | --- |
| 4 ports, with or without an advertised address | gathers candidates on every port of the range | gathers **no** candidate |
| unpinned | gathers | gathers, through eight peers |

The runtime gives each candidate of each peer its own socket, and two sockets
of one address family cannot share a port. A pinned range therefore caps how
many peers can hold candidates at once; a peer that finds it spent gathers
nothing and never connects. In a container with one interface and an advertised
address each peer takes two ports, so the installer's four-port range serves
two peers at a time — a pairing peer and a session peer, or two devices.

Consequences taken in the change: the image does not pin a range unless a
public host or an ICE port is configured; when it does, it pins sixteen ports;
the length is configurable; and the server logs `ice-range-exhausted` when a
peer gathers nothing under a pinned range.
`apps/terminay-server/test/pinned-ice-range-budget.test.mjs` keeps the
measurement.

## The image, driven by Desktop's pairing code from a container

`scripts/container-image-smoke.mjs` against the image built from this change,
on podman. The device runs in a second container from the same image. Podman
networks were created with `isolate=true`; direct signaling only.

| Case | Server | Device network | Result | Device's selected pair |
| --- | --- | --- | --- | --- |
| bare | no port published, no address, `--cap-drop=ALL --read-only` | same as server | paired, reconnected, held 10 s; server pair `host`/`host` | `host`/`prflx` |
| bare, recreated | new container, same volume, different hostname | same as server | reconnected with no pairing; same server identity | `host`/`prflx` |
| advertised | public host = host address, range published | isolated, derivation off | paired, reconnected, held 10 s | `host`/`host` |
| derived | direct origin on host, range pinned and published, no advertised address | isolated | paired, reconnected, held 10 s | `host`/`host` |
| control | as derived | isolated, derivation off | **timed out**, as it must | — |

The control case is what shows the isolated cases isolate: with neither an
advertised nor a derived candidate, no route exists.

## What this does not show

- The packaged Electron app was not used; only Desktop's pairing and reconnect
  modules, in Node. No terminal traffic was sent on the session.
- The macOS firewall was off. The server's first packet to Desktop is
  unsolicited inbound UDP.
- Docker Desktop and Windows were not measured. Linux bridge networking is
  exercised by the image smoke test in pull-request CI, not by hand.
- A browser was measured once, with an advertised address, before this change;
  it has not been run against the image.
