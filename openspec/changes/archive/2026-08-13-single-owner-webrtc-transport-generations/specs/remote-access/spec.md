## ADDED Requirements

### Requirement: Single connection generation per mounted workspace
The session origin host SHALL be the sole authority for browser WebRTC signaling, peers,
required data channels, authentication, and generation replacement. Each complete peer and
channel set SHALL have one monotonic generation identity, and every endpoint and lifecycle event
SHALL name its generation. An endpoint from a retired generation SHALL NOT send, reactivate, or
be returned again.

#### Scenario: Retired generation endpoint
- **WHEN** a mounted workspace holds an endpoint from a retired generation
- **THEN** it cannot send, cannot be reactivated, and is never returned again

#### Scenario: Lifecycle events name a generation
- **WHEN** a transport lifecycle event is published
- **THEN** it names the generation it belongs to

### Requirement: Explicit generation liveness signals
Peer, ICE, `control`, `application`, `terminal`, and `assets` health SHALL be evaluated through
one state machine. Close or error of any required lane SHALL be a terminal failure of that
generation even while the peer remains connected. A bounded grace period SHALL apply only to
recoverable peer or ICE `disconnected` state, SHALL be cancelled once the complete generation is
healthy, and SHALL NOT delay replacement for explicit failed or closed state or required-lane loss.

#### Scenario: Required lane closes while the peer is connected
- **WHEN** any required data lane closes or errors while the peer connection remains connected
- **THEN** that generation fails terminally and is replaced without a page reload

#### Scenario: Recoverable disconnect
- **WHEN** the peer or ICE state becomes `disconnected` and then healthy inside the grace period
- **THEN** the generation is preserved and the grace period is cancelled

### Requirement: One handshake at a time per room or session
Concurrent peer, ICE, channel, application-send, online/offline, and renderer signals SHALL be
coalesced into one replacement attempt, with cleanup and publication happening exactly once per
generation. Manual Retry SHALL call the same controller, cancel its pending backoff, and start
one immediate attempt. It SHALL NOT reload the document or create a parallel signaling room.
Peer, signaling, channel map, authentication promise, listeners, timers, and attempt-local state
SHALL be reset before replacement lanes are acquired, and a closed lane from a retired generation
SHALL never be awaited or consulted.

#### Scenario: Concurrent failure signals
- **WHEN** peer, ICE, channel, send, and renderer failure signals arrive together
- **THEN** exactly one replacement attempt runs and cleanup and publication happen once

#### Scenario: Retry during backoff
- **WHEN** the user presses Retry while a backoff is pending
- **THEN** the backoff is cancelled and one immediate attempt starts through the same controller, with no document reload and no parallel signaling room

### Requirement: Recovery scope and revocation
The transport host SHALL distinguish retryable offline, relay, and route failures from terminal
states. Revoked credentials, expired credentials, stopped exposure, explicit disconnect, forget,
and host shutdown SHALL stop replacement and present the correct actionable state.

#### Scenario: Terminal state stops replacement
- **WHEN** the connection is revoked, expired, has stopped exposure, was explicitly disconnected or forgotten, or the host shut down
- **THEN** replacement stops and the actionable terminal state is presented

#### Scenario: Retryable state continues
- **WHEN** the failure is an offline, relay, or route condition
- **THEN** replacement continues under the coalesced attempt with backoff

### Requirement: Pairing credential security invariants
Signaling sockets, reconnect credentials, application tickets, the peer connection, ICE state,
and every data channel SHALL remain private to the session transport host. The transport host
SHALL be bound to one exact session origin, server identity, profile id, device credential
compartment, and browser view, and SHALL reject another origin, source, profile, server, or a
retired generation.

#### Scenario: Wrong origin or profile
- **WHEN** a request arrives from another origin, source, profile, or server, or names a retired generation
- **THEN** the session transport host rejects it
