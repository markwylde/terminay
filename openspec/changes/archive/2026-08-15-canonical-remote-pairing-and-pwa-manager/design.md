## Context

See proposal.md. The change was framed as a clean cutover: superseded code,
storage schemas, settings, routes, UI, tests, and deployment behaviour are
deleted rather than kept behind flags, and no compatibility, migration, import,
alias, fallback, or dual-path behaviour is preserved.

## Goals / Non-Goals

Goals: one device identity and one reconnect protocol shared by browser,
Desktop, server runtime, signaling bootstrap, and tests; one WebRTC exposure
path; and a PWA whose entire role is a bookmark list.

Non-Goals: deployment and manual verification, which the change explicitly
excluded from its own scope. Automated routing, header, PWA-shell,
service-worker, archive, and retired-route checks stay in the two repository
test suites, and a release owner runs the published-artifact verifier
separately.

## Decisions

- **The session origin owns authentication; the manager never does.** The
  private key is created and stored at the exact session origin and is
  non-extractable, inaccessible to the PWA, the signaling service, the TURN
  service, workspace messages, logs, and analytics. Desktop keeps its private key
  in OS-protected main-process storage and out of renderers and preload APIs
  except for the narrow user-input invocation needed to pair.
- **A signed nonce challenge replaces reconnect grants.** Every challenge binds
  the server identity, exact session origin, device id, nonce, and expiry, and
  replay, cross-origin, cross-server, expired, and revoked proofs are rejected.
  The resulting connection ticket is short-lived, single-use, bound to the
  authenticated device and WebRTC peer, and never durably stored on the client.
- **The pairing fragment is the only pairing authority, and it is single-use.**
  It is consumed in memory and stripped from the visible URL and history before
  unrelated resources load or telemetry is emitted, and it is marked consumed
  only as part of a successful enrollment. Expired, consumed, malformed, denied,
  and network failures are distinct errors. The manager never persists, logs,
  copies into history, or sends it.
- **The manager saves the bookmark before navigating.** On **Add connection…**
  it validates the complete pairing URL, derives and saves or updates the
  stable-origin bookmark, then navigates the current tab to the unmodified
  pairing URL, so an interrupted pairing still leaves the bookmark. It rejects
  URL credentials, queries, unsupported schemes, and unsupported origins, and it
  never reports paired, connected, offline, expired, or revoked state.
- **One exposure path.** Deleting the LAN listener removes a second trust
  surface and a second failure mode, and eliminates automatic transport
  fallback. **Expose this server…** drives authenticated signaling, pairing
  policy, link generation, device administration, status, and stop-exposure
  through one server-owned authority.
- **Recovery is a fresh authenticated generation.** Automatic recovery and
  explicit Retry produce the same fresh WebRTC generation and resume confirmed
  workspace revisions and terminal sequence positions before enabling input.
  Server-owned work and PTYs survive disconnect, reload, reconnect, new
  pairing-link generation, and exposure changes.
- **No migration code.** Persisted remote-device state uses an explicit current
  schema and starts clean when another schema is encountered.

## Risks / Trade-offs

Invalidating existing pairings was accepted deliberately: retaining them would
have required keeping the grant machinery being deleted. The PWA caching its
shell to open offline creates a risk of implying liveness, so it is explicitly
forbidden from claiming an unreachable session origin is connected.

## Migration Plan

None by design. Existing remote browser and Desktop pairings are invalidated and
re-paired; no stored data is imported from the retired manager origin.
