# ADR-0034: Terminay operates no media relay; reachability comes from candidates, routing hints, and the user's own network

Status: accepted
Date: 2026-10-03

## Context

A peer connection between a client and a Terminay Server succeeds only if one
side can send a packet the other receives. A server in a container, behind a
port forward, or on a network with client isolation cannot always observe an
address the client can reach, and browsers conceal their local addresses
behind mDNS names. The conventional remedy is a TURN relay operated by the
service: it makes every network work and carries every byte of the sessions
that use it.

The owner has decided against operating one. Relayed terminal traffic is
bandwidth Terminay would pay for, and ADR-0011 already treats hosted
infrastructure as data-blind signaling, not a data path. ADR-0015 lets a
server host its own signaling so that a deployment need not depend on
`terminay.com` at all.

Measurement
([evidence](./evidence/container-reachability-without-advertised-address.md))
shows the common local case does not need a relay or even configuration:
Terminay Desktop offers its real host addresses, and a server that can route
to Desktop opens the path from its own side.

## Decision

1. Terminay operates no TURN server and no other relay for peer traffic. No
   default ICE configuration, on a host or a client, contains one. An
   administrator may configure a relay for their own server.
2. A peer connection is made over, in order of how much the operator must
   supply:
   - candidates either side gathers, including overlay-network addresses;
   - a connection the server opens toward the client's offered addresses,
     which Desktop makes possible by offering literal host addresses;
   - a candidate the client derives from the host it reached direct signaling
     through;
   - an address the administrator supplies for the server, as one public host.
3. Every supplied or derived address is a routing hint. It never affects host
   key pinning, the signed transport transcript, pairing material, or
   admission, and a connection over it is authenticated exactly as any other.
4. When no route exists, the client says so. The supported remedy is an
   overlay network such as Tailscale joining both ends, not a Terminay
   service.

## Consequences

- Terminay carries no session bytes and has no bandwidth cost that grows with
  usage.
- Some networks cannot connect without the user doing something: symmetric NAT
  on both sides, client isolation, or a firewall dropping inbound UDP to
  Desktop. The product must report this distinctly and document the overlay
  remedy.
- Browser and phone clients need the operator to supply a public host for a
  server whose address they cannot route to. Desktop usually does not.
- Desktop must keep offering literal host addresses. Moving Desktop's peer to
  a runtime that conceals them would bring back the configuration this
  decision removes, and needs a superseding ADR.
- Future connectivity work adds routing hints or candidate sources, never a
  Terminay data path.

## Open items

- Verify the server-initiated route with the packaged Desktop app and with the
  macOS firewall enabled.
- Measure Docker Desktop, Linux bridge networking, and Windows.
