# ADR-0015: A Terminay Server may host its own data-blind signaling endpoint, authenticated by the transport transcript alone

Status: accepted
Date: 2026-09-07

## Context

ADR-0011 records hosted signaling as untrusted for confidentiality and
integrity: registration proofs and client-verified transport transcripts make
endpoint substitution and credential relay impossible, so a compromised relay
can only deny service. ADR-0013 forbids any hosted HTTPS origin from carrying
a credential and keeps HTTP device endpoints on the loopback local-UI server
only. Until now the only relay was the one operated at `terminay.com`, so a
standalone server on a LAN, behind a corporate firewall, or in an
air-gapped network could not be reached from Desktop at all, and every
self-hosted deployment depended on Terminay's hosted service being up.

## Decision

A standalone Terminay Server may serve the signaling endpoint itself at
`/signal` on its own HTTPS origin ("direct exposure"), alone or alongside
hosted exposure.

1. The direct endpoint is data-blind. It routes the hosted relay's frame
   vocabulary by type between one registered host and admitted clients,
   enforces the same handshake caps and frame limits, and retains only
   routing state. It never parses transcripts, offers, or credentials.
2. Authentication of the endpoint is the server host key's signature over
   the transport transcript and the DTLS fingerprints, exactly as for the
   hosted relay. The listener's TLS certificate is self-signed, generated
   into the data root, and is not part of the trust model. Clients disable
   certificate verification only for a socket opened to a direct origin that
   came from a pairing link or a saved profile.
3. Every ADR-0013 invariant applies unchanged: pairing token, device key,
   challenge, ticket, approval, UI archive, and host context cross only
   transport-authenticated data channels. Direct exposure adds no HTTPS
   credential path.
4. Direct and hosted exposure share one server host key, one device registry,
   and one approval queue, so a device is paired once regardless of path.

## Consequences

- Self-hosted servers no longer depend on Terminay's hosted relay to be
  reachable from Desktop, and the trust-boundary table's "Server ↔ hosted
  signaling" row applies verbatim to the self-hosted endpoint.
- Browsers cannot use a direct origin, because they will not accept the
  self-signed listener; browser access keeps requiring an operator-provided
  certificate in front of the server.
- The direct endpoint is a new denial-of-service surface on the server's own
  port and inherits the hosted host's caps; it must not be given any
  authority beyond routing.
- Operators must be told, in readiness output and the runbook, that the
  certificate warning-free path is not what protects them; the host key is.
