## Why

Someone evaluating Terminay should be able to download Desktop, run a server in
a container on the same machine, and connect to it. Today that fails, and the
failure is invisible: signaling succeeds, the browser finds the server, and then
ICE sits in `checking` until the peer closes with "did not open the api
bootstrap lane".

The cause is that a containerised server advertises only addresses the client
cannot route to. On macOS and Windows the container runs inside a Linux VM, so
its host candidate (`10.88.x`, `172.17.x`) does not exist on the client's
machine, and `--network host` does not help because the host is the VM. Both
peers being behind one NAT means the reflexive candidates share a public address
and need router hairpinning, which consumer routers usually lack. Every
candidate pair is unusable, so the connection never forms.

A published UDP port is the one path that does work. Verified against podman's
gvproxy: a container with `-p 51000:51000/udp` receives datagrams sent to
`127.0.0.1:51000` on the host and its replies arrive back, so an ICE candidate
naming that address and port is reachable from the client.

## What Changes

- The server gains an administrator-supplied **advertised ICE address**: an
  address and UDP port added to the candidates it offers, for the case where the
  address it can observe about itself is not the address clients reach it on.
- Supplying one pins the ICE socket to that UDP port, because a candidate is
  only publishable if its port is known ahead of time. Without it the port is
  ephemeral and cannot be forwarded.
- `terminay daemon install` and `daemon upgrade` accept `--advertise-address
  <host>:<port>`, record it, and write it into the service environment.
- The advertised candidate is offered in addition to the addresses the server
  already gathers, never instead of them, so enabling it cannot remove a path
  that already worked.
- Documentation gains the container recipe this makes possible: one `docker run`
  with a published UDP port, one `daemon install`, then pair from Desktop
  through the hosted signaling service exactly as a remote server would.

Exposure, pairing, approval, and transport authentication are unchanged. This
adds a candidate to an existing offer; it does not add a transport, a listener,
or a trust relationship.

## Capabilities

### Modified Capabilities

- `remote-access`: exposure gains an administrator-supplied advertised ICE
  address, stated as an addition to gathered candidates rather than a
  replacement, and constrained so it cannot be used to redirect a peer.
- `daemon-cli`: `install` and `upgrade` accept and persist
  `--advertise-address`, and the runbook documents the local-container flow.

## Impact

- `apps/terminay-server/src/remote/hostedPeerLifecycle.ts`: the existing unused
  `hostAddresses` parameter becomes the wired path for this, plus an ICE port
  range so the socket is predictable.
- `apps/terminay-server/src/cliOptions.ts`: `--advertise-address` and
  `TERMINAY_WEBRTC_ADVERTISE_ADDRESS`.
- `apps/terminay-cli`: flag, validation, install record, environment file.
- `docs/operations/standalone-server.md` and the CLI README: the container
  recipe.
- No protocol change. An older client receives one extra candidate and either
  uses it or ignores it.
