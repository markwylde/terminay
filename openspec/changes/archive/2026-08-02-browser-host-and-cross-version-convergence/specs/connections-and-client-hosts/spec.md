## ADDED Requirements

### Requirement: Web connection host scope
The deployed browser manager SHALL be limited to connection profiles, pairing
and reconnect, signaling and WebRTC bootstrap, bundle verification and
installation, isolated session launch, and bounded failure and recovery UI. It
MUST NOT contain an independently versioned full workspace build in its
artifact or its normal module graph.

#### Scenario: No workspace in the manager artifact
- **WHEN** the deployed manager artifact and its module graph are inspected
- **THEN** no full workspace entry, renderer, or feature tree is present

#### Scenario: The server supplies the workspace
- **WHEN** a session is launched from the manager
- **THEN** the selected server supplies the complete workspace and its matching
  client, and the manager supplies only bootstrap, transport, bundle
  installation, and browser presentation

### Requirement: Bundle content stays out of the manager origin
Each server bundle SHALL be installed and executed only in its exact isolated
session origin. The manager origin MUST NOT execute unrelated server code or
hold session credentials, and only the browser host context and the opaque byte
endpoint SHALL cross the closed exact-source, exact-origin bridge.

#### Scenario: Bridge payload is bounded
- **WHEN** the manager launches a session
- **THEN** only the declared host context and an opaque byte endpoint are
  passed, and any other sender, origin, or payload shape is rejected

#### Scenario: Sibling origins stay isolated
- **WHEN** two session origins and the manager origin are open
- **THEN** none can read another's credentials, caches, DOM, transports, or
  workspace state

### Requirement: Verified bundle cache
A verified bundle SHALL be committed atomically. Interruption, an invalid hash,
an unsafe path, an incompatible requirement, or a server-identity mismatch
SHALL leave the previously installed complete bundle in place.

#### Scenario: Interrupted install
- **WHEN** bundle installation is interrupted partway
- **THEN** the previous complete bundle remains installed and executable

#### Scenario: Identity mismatch
- **WHEN** a bundle's server identity does not match the connected server
- **THEN** the bundle is rejected and not committed

### Requirement: Bundle manifest compatibility
Compatible host shells SHALL connect across server application versions without
interpreting feature frames. An incompatible required boundary SHALL fail
before launch with a typed upgrade requirement, and an absent optional host
capability SHALL degrade without disconnecting.

#### Scenario: Newer server, compatible host
- **WHEN** a compatible host shell connects to a newer server application
  version
- **THEN** the session launches and the host does not interpret feature frames

#### Scenario: Required boundary unmet
- **WHEN** a required boundary declared by the bundle manifest is unmet
- **THEN** launch fails beforehand with a typed upgrade requirement

### Requirement: One workspace renderer per selected server
Local Desktop, remote Desktop, direct browser, and browser-manager sessions
against one server SHALL execute that server's same verified workspace bundle
and report the same server-owned identities.

#### Scenario: Four launch paths converge
- **WHEN** the same server is opened through each of the four launch paths
- **THEN** each reports the same verified bundle id and the same server-owned
  identities

### Requirement: Manager is not part of the credential path
Manager persistence SHALL hold sanitized profile metadata only. Origin
credentials and bundle storage MUST NOT appear in profile messages, URLs, logs,
or analytics. A direct session-origin launch SHALL remain available and SHALL
offer a route back to connection management without transferring credentials.

#### Scenario: Metadata-only manager records
- **WHEN** manager persistence, profile messages, URLs, and logs are inspected
- **THEN** none contains credential or bundle storage content

#### Scenario: Return from a direct session
- **WHEN** a user opened a session origin directly and returns to connection
  management
- **THEN** no credential is transferred to the manager origin
