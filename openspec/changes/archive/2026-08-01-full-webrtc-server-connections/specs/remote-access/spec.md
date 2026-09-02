## ADDED Requirements

### Requirement: Remote access is a full server connection
A remote client SHALL connect to a Terminay Server as a complete application-protocol
connection carrying workspace commands and events, terminal streams, and bounded content —
not as a terminal-only viewer. The WebRTC host SHALL be owned by Terminay Server; no client
host SHALL run a hidden renderer as the peer host.

#### Scenario: Displayless standalone server
- **WHEN** a client pairs with a displayless standalone Terminay Server and connects
- **THEN** it runs the full server-bundled workspace UI over that connection

#### Scenario: Same behaviour as a Local client
- **WHEN** the application protocol behaviour suite runs against a Local client and a remote
  client
- **THEN** both pass the same suite

### Requirement: Four isolated traffic lanes
An authenticated remote session SHALL carry connection control, application commands and
events, terminal streams, and assets or binary content on four isolated channels, each with
its own bounds and backpressure. The four-lane, limit, cleanup, and admission contract SHALL
be transport-neutral and identical for every headless runtime.

#### Scenario: Lane set must match the admitted contract
- **WHEN** a native allocation provides a channel set that differs from the authenticated
  requested contract, or reuses one channel for two lanes
- **THEN** every allocated channel is closed and no peer is published

#### Scenario: A required lane closes after setup
- **WHEN** any required traffic lane closes after setup
- **THEN** the complete channel allocation and signaling subscription are torn down rather
  than retaining a half-live session

#### Scenario: One transport owner per channel
- **WHEN** a second application transport attempts to take over a live channel
- **THEN** it is refused; replacement requires the prior channel to close and a freshly
  admitted reconnect session

### Requirement: Selected runtime identity is verified before exposure
The server-owned WebRTC runtime SHALL be an integrity-verified selected artifact. Its
identity SHALL be carried through admission rather than assumed, and a mismatched runtime
label SHALL be rejected before signaling or native allocation. A build with no verified,
packaged runtime SHALL fail exposure before publishing a pairing URL or allocating a hosted
signaling room.

#### Scenario: Missing or invalid artifact
- **WHEN** exposure is requested and the packaged runtime selection is missing, malformed, or
  integrity-invalid
- **THEN** exposure fails closed with one actionable error, status remains stopped, and no
  pairing handoff, pairing URL, room registration, signaling allocation, device, grant, or
  ticket is created

#### Scenario: Runtime label mismatch
- **WHEN** an injected host presents a runtime label that differs from the selected identity
- **THEN** admission rejects it before signaling subscription or native peer allocation

### Requirement: No data before transport authentication
Application handshake and authorization SHALL complete only after device key and PIN or
approval verification. Commands received before authentication, after revocation, with stale
connection identity, or bearing another server or session origin SHALL be rejected.

#### Scenario: Replayed application ticket
- **WHEN** an already-consumed application ticket is presented
- **THEN** it is rejected by a bounded preflight assertion before either cryptographic
  verifier is invoked, and concurrent handshakes still cannot both connect

#### Scenario: Cross-server proof
- **WHEN** an application proof names another Terminay Server or another session origin
- **THEN** it is rejected before any verifier receives device or approval material and no
  peer is created

### Requirement: Fragment-only single-use pairing material
Pairing material SHALL be carried only in the URL fragment, never in query parameters, and
SHALL be single-use, expiring, origin-bound, and revocable. The bootstrap parser SHALL
require exactly one bounded session id, token, and expiry field and SHALL reject ambiguous or
control-bearing frames. A host SHALL accept only an exact HTTPS or loopback-HTTP server
origin, with no embedded credentials.

#### Scenario: Ambiguous fragment
- **WHEN** a pairing fragment repeats a field or carries control characters
- **THEN** the parser rejects it before any pairing request is issued

#### Scenario: Invalid pairing target
- **WHEN** a pairing URL names a non-origin, credentialed, or non-loopback HTTP target, or
  carries an expired or malformed expiry
- **THEN** the host rejects it before creating a device key or issuing a privileged request

### Requirement: Server-owned exposure lifecycle
Exposure start and stop, pairing-room rotation, device and grant stores, audit, connection
records, and status SHALL live in Terminay Server and SHALL be identical for embedded and
standalone servers. An embedded Local server SHALL remain loopback-only until exposure is
explicitly enabled. Stopping exposure SHALL reject new peers without stopping server work or
disconnecting existing local clients.

#### Scenario: Explicit exposure
- **WHEN** an embedded Local server has not been explicitly exposed
- **THEN** it accepts only loopback connections and advertises no pairing material

#### Scenario: Stopping exposure fences pending negotiation
- **WHEN** exposure stops while an authenticated headless negotiation is in flight
- **THEN** the late runtime result closes its complete channel allocation and cannot publish
  a session, while established remote sessions and local work continue

#### Scenario: Offline reporting
- **WHEN** the server is not advertising
- **THEN** reconnect availability is reported as offline rather than as an available lease

### Requirement: Reconnect restores position and is bounded
Reconnect SHALL restore the workspace revision and terminal output positions for the
resumed session. Reconnect challenge and proof material SHALL be server-owned, single-use,
and rate-limited by server-owned identity, and unknown handles SHALL be rejected before any
retry ledger capacity is reserved.

#### Scenario: Resume restores state
- **WHEN** a paired device reconnects
- **THEN** the handshake response carries the canonical workspace revision and the
  project-scoped terminal positions

#### Scenario: Guessed handles cannot exhaust capacity
- **WHEN** unknown reconnect handles are submitted repeatedly
- **THEN** they are rejected before reserving retry ledger capacity, and a valid device's
  reconnect remains admissible

#### Scenario: Revoked or rotated grant releases challenges
- **WHEN** a grant is revoked or superseded by rotation
- **THEN** its pending challenges are released immediately rather than occupying bounded
  capacity until expiry

### Requirement: Revocation is immediate and terminal
Revoking a device SHALL close its channels and peer, release its signaling subscription and
limiter metadata, abort in-flight credential and signaling requests, and reject all future
proof from that identity.

#### Scenario: Revocation during negotiation
- **WHEN** a device is revoked while its authenticated negotiation is in flight
- **THEN** the negotiation is aborted, any late result closes every returned traffic lane,
  and no session is published

#### Scenario: Faulty binding during revocation
- **WHEN** a native data-channel binding omits its close callbacks during revocation
- **THEN** the authenticated signaling subscription is still closed

### Requirement: Native and signaling boundaries fail closed
The server SHALL treat the native WebRTC binding and inbound signaling as untrusted. Blank,
malformed, oversized, or role-conflicting SDP and ICE; unknown lifecycle states; throwing
label lookups, open-state inspection, or lifecycle registration; invalid or throwing
buffered-byte counters; frames arriving after a channel leaves the open state; and late or
already-closed channel allocations SHALL each close the peer and release its signaling
subscription rather than admitting a session.

#### Scenario: Oversized native frame
- **WHEN** a native data channel delivers a frame above the session frame limit
- **THEN** the channel fails closed at the native boundary and the peer and session are
  released before the frame enters the server-owned queue

#### Scenario: Deferred and bounded ICE
- **WHEN** authenticated ICE candidates arrive before the remote description is accepted
- **THEN** they are queued in a bounded queue, delivered in order after acceptance, and
  overflow tears down the peer and its signaling subscription

#### Scenario: Stalled asynchronous dependency
- **WHEN** a signer, relay send, or signaling verifier stalls beyond its deadline
- **THEN** the peer is closed and its signaling subscription released rather than retaining
  an unbounded queue

### Requirement: Signaling is same-origin and canonical
A signaling upgrade SHALL be admitted only on the exact isolated session origin and the
canonical `/signal` WebSocket endpoint. Manager-only hosts, mismatched hosts, collapsed
origins, and non-canonical, whitespace-normalized, comma-separated, or control-bearing
`Host` values SHALL be rejected before a relay is allocated.

#### Scenario: Manager host rejected
- **WHEN** a signaling upgrade arrives on the manager origin
- **THEN** it is rejected before any signaling connection is allocated

#### Scenario: Non-canonical host framing
- **WHEN** a `Host` header carries comma-separated or control-bearing values that normalize
  to the session origin
- **THEN** the upgrade is rejected

### Requirement: Hosted signaling credentials are registrar-minted
The signaling credential for a remote peer SHALL be minted by the hosted registrar, not by
Terminay Server. The shared protocol parser SHALL bind the returned origin, server, device,
and peer identities, expiry, canonical route, and bounded ICE configuration to the admitted
reconnect, and SHALL reject incompatible versions, cross-origin routes, URL credentials,
query secrets, unknown fields, and overlong credentials before any socket or native
allocation. A client SHALL NOT silently downgrade to a lesser transport when this fails.

#### Scenario: Mismatched bootstrap
- **WHEN** a returned signaling bootstrap disagrees with the admitted reconnect on origin,
  version, role, expiry, or identity
- **THEN** it is rejected before socket or runtime allocation and no bootstrap is returned

#### Scenario: No silent downgrade
- **WHEN** the WebRTC path fails after a bootstrap is supplied
- **THEN** the connection fails visibly, and the unused HTTP ticket transport is closed on
  both success and failure rather than becoming a silent fallback

### Requirement: TURN credentials are short-lived and unrelated
STUN discovery endpoints SHALL be static configuration. TURN credentials SHALL be supplied
per admitted peer by an injected provider that receives connection identity only, and SHALL
expire within ten minutes. A stalled credential request SHALL be aborted on shutdown or
revocation before it can allocate signaling or a native peer.

#### Scenario: Long-lived credential rejected
- **WHEN** a provider returns a TURN credential whose lifetime exceeds ten minutes
- **THEN** it is rejected and no peer is allocated with it

### Requirement: Hosted services stay data-blind
Remote audit retention and sinks SHALL record metadata only, using closed action and reason
allowlists, and SHALL drop arbitrary payload fields. Aggregate host snapshots and cleanup
reports SHALL carry no device, ticket, signaling, credential, SDP, or application data;
expired limiter metadata SHALL be reported only as a reclaimed count. TURN counters SHALL
report only that ephemeral relay configuration was available.

#### Scenario: Audit record contents
- **WHEN** pairing, reconnect, revocation, and cleanup events are serialized to a sink
- **THEN** no pairing, reconnect, device, or PIN secret and no application payload appears in
  any persisted record

#### Scenario: Audit sink outage
- **WHEN** the metadata-only audit sink is unavailable
- **THEN** pairing, reconnect-grant revocation, and cleanup still complete, with the bounded
  in-memory event retained

### Requirement: Clock and entropy faults are terminal
If the pairing clock becomes invalid after a room is issued, active rooms SHALL become
terminal and SHALL NOT regain usability if the clock later recovers; fresh material is
required. If the remote runtime clock becomes invalid, exposure SHALL be disabled and new
admission and traffic work rejected while existing session metadata stays finite. If the
pairing entropy source repeats an active room id or one-time secret, the server SHALL retry a
bounded number of complete candidates and SHALL NOT overwrite an active room.

#### Scenario: Persistent entropy collision
- **WHEN** the entropy source repeatedly produces an active room id or secret
- **THEN** the new pairing is rejected and the existing secret remains usable

#### Scenario: Regressing clock
- **WHEN** an injected clock regresses or returns an invalid value
- **THEN** retained and sinked audit timestamps remain finite, non-negative, and
  non-decreasing, and aggregate duration measurements remain finite

### Requirement: Rate limiting derives from server-owned identity
Pairing admission rate-limit buckets SHALL derive only from server-owned room identity.
Per-device authenticated WebRTC setup attempts SHALL be limited before admission, signaling
subscription, optional native-module load, or peer allocation. A setup denied for global
pending capacity, or from an already-aborted caller, SHALL NOT consume that device's limiter
window. Expired limiter metadata SHALL be pruned during cleanup and status inspection, and a
revoked device's metadata SHALL be cleared immediately.

#### Scenario: Client field cannot select a limiter key
- **WHEN** a client supplies a differing identifier with each wrong pairing secret
- **THEN** all attempts fall in the same server-owned room bucket and the bounded one-time
  window still applies

#### Scenario: Capacity rejection does not penalise the device
- **WHEN** a device's setup is denied because another connection occupies the bounded host
  slot
- **THEN** that device's limiter window is not consumed and a later attempt remains
  admissible
