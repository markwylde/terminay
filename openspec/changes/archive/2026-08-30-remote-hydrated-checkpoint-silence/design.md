## Context

See proposal.md. The existing tests encoded the Safari ICE consent blip and the
*logging* of stalls; none of them failed a silent hydrated generation, so a
session that had painted once and then gone quiet looked healthy to every check
in place.

## Goals / Non-Goals

Goals: a hydrated-but-dead generation is failed, shows an error, and reconnects
rather than staying mounted as Connected.

Non-Goals: changing the ICE consent-blip handling, which stays as it is.

## Decisions

- **Required-lane close is a failure; handshake-lane close is not.** The
  required set is `application`, `control`, `terminal`, and `assets`; `api` and
  `asset` handshake closes are expected and must not retire a generation.
- **Silence on the inbound side is recovered, not ignored.**
  `SessionConnectGate.shouldRecoverFromSilence` recovers a ready attempt on
  `inbound-stalled` and `no-inbound`, and the workspace shows reconnecting while
  replacing the generation.
- **ICE `disconnected` while the peer is `connected` remains a consent blip**, so
  the new failure paths do not re-introduce spurious reconnects.

## Risks / Trade-offs

Treating `outbound-stalled` and `no-outbound` as generation failures makes a
traffic pattern authoritative over liveness, which risks failing a healthy but
quiet session. That trade-off was accepted here to close the silent-session
defect and was revisited the following day.
