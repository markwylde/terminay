## ADDED Requirements

### Requirement: Bundle content stays out of the manager origin
The server-bundled workspace SHALL receive only an opaque application byte endpoint and its
lifecycle contract. It SHALL NOT hold raw WebRTC objects, signaling sockets, reconnect secrets,
or per-channel authority, and SHALL NOT be able to obtain them.

#### Scenario: No raw channel access
- **WHEN** the server-bundled workspace inspects its transport
- **THEN** it finds only an opaque byte endpoint and lifecycle events, with no channel accessor, peer connection, or reconnect secret

#### Scenario: Deleted bridge globals are absent
- **WHEN** production code is checked statically
- **THEN** no raw-channel bridge global, channel accessor, renderer-side WebRTC transport constructor, or reload-as-recovery path is present

### Requirement: Verified bundle cache
Bootstrap enrollment and bundle-install lanes SHALL be attempt-scoped. They SHALL be closed and
deleted at the authenticated canonical-lane handoff and SHALL NOT remain visible to, or be
revived by, the mounted application.

#### Scenario: Lanes absent after handoff
- **WHEN** the authenticated canonical-lane handoff completes
- **THEN** the bootstrap enrollment and singular bundle-install lanes are closed and deleted
- **AND** the mounted application cannot request or revive them

### Requirement: Framed session liveness
Automatic recovery and manual Retry SHALL NOT create concurrent signaling rooms, peers, channel
sets, application clients, or server connections. Recovery SHALL replace the transport in-page;
normal browser refresh SHALL still re-enter the session entry point.

#### Scenario: In-page recovery
- **WHEN** the transport fails and recovery runs, automatically or through Retry
- **THEN** a fresh authenticated endpoint is delivered in-page with no document reload and exactly one signaling room, peer, channel set, application client, and server connection
