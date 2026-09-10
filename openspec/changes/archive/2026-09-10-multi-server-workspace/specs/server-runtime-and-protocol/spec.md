## ADDED Requirements

### Requirement: Bundle acquisition per host

Desktop SHALL obtain the workspace bundle from its pinned embedded-server artifact, launch it through the declared verification and host-context contract, and run it for every connection the window holds, without requiring a network listener and without downloading a bundle from any server. A browser session SHALL obtain the bundle from its primary connection's stable session origin through that origin's verified asset flow; an attached server SHALL deliver no bundle. `app.terminay.com` SHALL be the connection manager only: it stores stable-origin bookmarks, frames them, opens transports for attached servers, and SHALL NOT execute a server's workspace bundle as manager-origin script. A server UI SHALL remain usable when opened directly at its session origin.

#### Scenario: Desktop attaches a remote server

- **WHEN** Desktop attaches a remote server connection
- **THEN** it runs the bundle from its pinned embedded-server artifact and downloads no bundle for that server

#### Scenario: Manager framing a server

- **WHEN** `app.terminay.com` opens a bookmarked server
- **THEN** it frames the stable session origin and does not execute the server's bundle as manager-origin script

#### Scenario: Browser attaches a second server

- **WHEN** a framed browser session attaches a second server
- **THEN** the primary origin's bundle keeps serving the window and the attached server delivers no bundle

#### Scenario: Desktop launch

- **WHEN** Desktop launches a window
- **THEN** the bundle comes from the pinned embedded-server artifact and is verified through the declared contract, with no network listener opened

## MODIFIED Requirements

### Requirement: Servers bundle their own workspace UI

Every server SHALL bundle the complete responsive Terminay workspace UI built from the same source as the desktop experience, together with the application-protocol client matching that server. A browser connection SHALL run the UI version shipped with the server it opened, which is that session's primary connection, rather than an independently deployed workspace build.

#### Scenario: Connecting to a server

- **WHEN** a browser host opens a server as its primary connection
- **THEN** it runs that server's bundled workspace UI and matching application-protocol client

#### Scenario: Direct session URL

- **WHEN** a user opens a server's session URL directly
- **THEN** the exact UI bundle shipped by that server is installed and run

### Requirement: Versioned application protocol

Terminay SHALL use one versioned application protocol above every transport as the canonical client/server contract across local and remote connections. It SHALL carry a supported version range rather than a single version, and SHALL express features as versioned capability strings such as `workspace.v1`, `terminal.v1`, `files.v1`, `git.v1`, `agents.v1`, and `settings.v1`. Every registered operation SHALL belong to exactly one declared capability. The handshake SHALL negotiate both: the client hello SHALL carry the client's supported protocol range and its required and optional capability sets, and the server hello SHALL answer with its protocol version, server version, stable server identity, client identity, authorization scope, and declared capability set. It SHALL include correlated commands and responses with runtime-validated payloads; revisioned workspace snapshots and ordered mutation events; resumable terminal output with per-session sequence positions and bounded snapshots; typed activity, agent, file-watch, settings, recording, and connection events; bounded binary transfer for files, previews, recordings, dictation audio, and server-bundled assets; and cancellation, deadlines, backpressure, and explicit resource limits.

#### Scenario: Opening a connection

- **WHEN** a client opens an application connection
- **THEN** the client hello carries its supported protocol range and required and optional capabilities, and the server hello answers with the protocol version, server version, stable server identity, client identity, authorization scope, and declared capability set

#### Scenario: Invalid command payload

- **WHEN** a command payload fails runtime validation
- **THEN** the command is rejected at the server boundary

#### Scenario: Resuming terminal output

- **WHEN** a client resubscribes to a terminal session with a sequence position
- **THEN** output resumes from that position with a bounded snapshot

#### Scenario: Every operation belongs to a capability

- **WHEN** an operation is registered on the server
- **THEN** it belongs to exactly one declared capability string

### Requirement: Host supplies transport and presentation bridge only

The host SHALL supply two independent boundaries: one opaque framed byte transport per connection, each connected to its own authenticated server, and a versioned capability-negotiated presentation bridge for optional native host actions. The host SHALL forward valid bounded frames without decoding feature operations, workspace DTOs, or application events, and SHALL keep each connection's frames on its own endpoint. Authentication material, reconnect grants, private keys, signaling credentials, and transport handles SHALL remain in the host's privileged connection runtime, and the workspace renderer SHALL receive only the scoped byte endpoints and sanitized connection identities needed to construct one `TerminayClient` per connection.

#### Scenario: Forwarding application traffic

- **WHEN** application frames pass through the host
- **THEN** the host forwards them without decoding feature operations, workspace DTOs, or application events

#### Scenario: Renderer construction

- **WHEN** the workspace renderer is launched
- **THEN** it receives only the scoped byte endpoints and sanitized connection identities, not credentials, keys, or raw transport handles

#### Scenario: Several connections in one window

- **WHEN** a window holds three connections
- **THEN** the host supplies three independent byte endpoints and no frame crosses between them

### Requirement: Bundle manifest declarations govern launch

The WebRTC archive metadata SHALL declare its supported application-protocol version range, the server capabilities its client requires and those it treats as optional, its bundle format, its supported host-bridge range, and its required and optional host capabilities. The host SHALL validate the bundle format, host-bridge range, and host capabilities, and SHALL NOT use browser brand, user agent, or numeric browser or Chromium runtime-version ranges. The declared protocol range and server capabilities SHALL be evaluated by the bundle's client during the hello for each connection rather than by the host. Optional native capabilities SHALL NOT become requirements merely because the bundle runs inside Desktop.

#### Scenario: Bundle running in Desktop

- **WHEN** a bundle declaring optional native capabilities runs inside Desktop
- **THEN** those optional capabilities remain optional

#### Scenario: Host-bridge range mismatch

- **WHEN** the host bridge version falls outside the archive's supported range
- **THEN** launch fails before the workspace starts

#### Scenario: Declared server contract is negotiated, not gated by the host

- **WHEN** the manifest declares a protocol range and required server capabilities
- **THEN** the bundle's client evaluates them per connection during the hello and the host does not

### Requirement: Desktop byte endpoint binds server identity

The Desktop byte endpoint SHALL wrap each framed byte message in a stable versioned packet bound to the exact server identity of the connection it serves before it reaches that connection's `TerminayClient`. The privileged host SHALL fix that identity when constructing each endpoint. Inbound packets for another server or with an invalid bounded shape SHALL be rejected while feature-level frame contents remain opaque to the host. The renderer SHALL receive no raw native transport or credential authority, and SHALL reach a server only through that server's own byte endpoint.

#### Scenario: Packet for another server

- **WHEN** an inbound packet names a server identity other than its endpoint's fixed identity
- **THEN** it is rejected

#### Scenario: Malformed packet

- **WHEN** an inbound packet has an invalid bounded shape
- **THEN** it is rejected without the host inspecting feature-level frame contents

#### Scenario: One endpoint per attached server

- **WHEN** a window attaches a second server
- **THEN** a second endpoint is constructed with that server's fixed identity and neither endpoint accepts the other's packets

### Requirement: Contract and bootstrap failure reporting

An invalid protocol or capability contract SHALL be reported per connection with a clear error before that connection's application traffic begins, and the message SHALL name whether that server or the client's bundle must be upgraded. Bootstrap failure SHALL identify the failing session-origin contract without exposing endpoint credentials, pairing fragments, or renderer state.

#### Scenario: Invalid capability contract

- **WHEN** a capability contract fails validation for a connection
- **THEN** a clear error naming the side that must be upgraded is reported for that connection before its application traffic begins

#### Scenario: Bootstrap failure message

- **WHEN** bootstrap fails
- **THEN** the message identifies the failing session-origin contract and exposes no endpoint credentials, pairing fragments, or renderer state

### Requirement: Non-goals

Terminay SHALL NOT provide cloud storage or proxying of workspace and application data, an independent latest workspace application at `app.terminay.com`, a requirement that Local connections use WebRTC, peer-to-peer collaborative text editing, or a promise that PTYs survive a server-process or machine restart.

#### Scenario: Local connection transport choice

- **WHEN** a Local connection is established
- **THEN** WebRTC is not required

#### Scenario: Workspace data storage

- **WHEN** workspace or application data is persisted
- **THEN** it is stored by the server that owns it and not in cloud storage or proxied through hosted infrastructure

## REMOVED Requirements

### Requirement: Bundle acquisition per connection kind

**Reason:** Bundle acquisition is a property of the host rather than of each connection: Desktop runs its packaged bundle for every connection and a browser session runs the bundle of the server it opened. Replaced by "Bundle acquisition per host".

**Migration:** None; there are no installed users.
