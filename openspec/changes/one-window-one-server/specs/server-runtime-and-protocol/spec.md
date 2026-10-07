## MODIFIED Requirements

### Requirement: Servers bundle their own workspace UI

Every server SHALL bundle the complete responsive Terminay workspace UI built from the same source as the desktop experience, together with the application-protocol client matching that server. A browser connection SHALL run the UI version shipped with the server it opened, which is the one server that session shows, rather than an independently deployed workspace build.

#### Scenario: Connecting to a server

- **WHEN** a browser host opens a server
- **THEN** it runs that server's bundled workspace UI and matching application-protocol client

#### Scenario: Direct session URL

- **WHEN** a user opens a server's session URL directly
- **THEN** the exact UI bundle shipped by that server is installed and run

### Requirement: Bundle manifest declarations govern launch

The WebRTC archive metadata SHALL declare its supported application-protocol version range, the server capabilities its client requires and those it treats as optional, its bundle format, its supported host-bridge range, and its required and optional host capabilities. The host SHALL validate the bundle format, host-bridge range, and host capabilities, and SHALL NOT use browser brand, user agent, or numeric browser or Chromium runtime-version ranges. The declared protocol range and server capabilities SHALL be evaluated by the bundle's client during the hello of the window's connection rather than by the host. Optional native capabilities SHALL NOT become requirements merely because the bundle runs inside Desktop.

#### Scenario: Bundle running in Desktop

- **WHEN** a bundle declaring optional native capabilities runs inside Desktop
- **THEN** those optional capabilities remain optional

#### Scenario: Host-bridge range mismatch

- **WHEN** the host bridge version falls outside the archive's supported range
- **THEN** launch fails before the workspace starts

#### Scenario: Declared server contract is negotiated, not gated by the host

- **WHEN** the manifest declares a protocol range and required server capabilities
- **THEN** the bundle's client evaluates them during the hello of the window's connection and the host does not

### Requirement: Contract and bootstrap failure reporting

An invalid protocol or capability contract SHALL be reported for the window's connection with a clear error before that connection's application traffic begins, and the message SHALL name whether the window's server or the client's bundle must be upgraded. The error SHALL be a state of the whole window. Bootstrap failure SHALL identify the failing session-origin contract without exposing endpoint credentials, pairing fragments, or renderer state.

#### Scenario: Invalid capability contract

- **WHEN** a capability contract fails validation for a window's connection
- **THEN** a clear error naming the side that must be upgraded is reported in that window before the connection's application traffic begins

#### Scenario: Bootstrap failure message

- **WHEN** bootstrap fails
- **THEN** the message identifies the failing session-origin contract and exposes no endpoint credentials, pairing fragments, or renderer state

## ADDED Requirements

### Requirement: Host supplies one byte transport and a presentation bridge

The host SHALL supply a window two independent boundaries: one opaque framed byte transport, connected to the one authenticated server the window is bound to, and a versioned capability-negotiated presentation bridge for optional native host actions. The host SHALL forward valid bounded frames without decoding feature operations, workspace DTOs, or application events, and SHALL keep each window's frames on that window's own endpoint. A window SHALL be given no byte endpoint for any server other than its own. Authentication material, reconnect grants, private keys, signaling credentials, and transport handles SHALL remain in the host's privileged connection runtime, and the workspace renderer SHALL receive only the one scoped byte endpoint and the sanitized connection identity needed to construct its one `TerminayClient`.

#### Scenario: Forwarding application traffic

- **WHEN** application frames pass through the host
- **THEN** the host forwards them without decoding feature operations, workspace DTOs, or application events

#### Scenario: Renderer construction

- **WHEN** the workspace renderer is launched
- **THEN** it receives only the one scoped byte endpoint and the sanitized connection identity, not credentials, keys, or raw transport handles

#### Scenario: One endpoint for the window's server

- **WHEN** a window is bound to a server
- **THEN** the host supplies exactly one byte endpoint, for that server, and none for any other server

#### Scenario: Windows showing different servers

- **WHEN** three windows show three different servers
- **THEN** the host supplies each window its own byte endpoint and no frame crosses between them

### Requirement: Desktop byte endpoint is bound to the window's server

The Desktop byte endpoint SHALL wrap each framed byte message in a stable versioned packet bound to the exact server identity of the window's server before it reaches the window's `TerminayClient`. The privileged host SHALL fix that identity when constructing the endpoint. Inbound packets for another server or with an invalid bounded shape SHALL be rejected while feature-level frame contents remain opaque to the host. The renderer SHALL receive no raw native transport or credential authority, and SHALL reach the window's server only through that one byte endpoint.

#### Scenario: Packet for another server

- **WHEN** an inbound packet names a server identity other than its endpoint's fixed identity
- **THEN** it is rejected

#### Scenario: Malformed packet

- **WHEN** an inbound packet has an invalid bounded shape
- **THEN** it is rejected without the host inspecting feature-level frame contents

#### Scenario: One endpoint per window

- **WHEN** two windows show two different servers
- **THEN** each window's endpoint is constructed with its own server's fixed identity and neither endpoint accepts the other's packets

#### Scenario: Switching the window's server

- **WHEN** a window is switched to another server
- **THEN** the new document receives an endpoint constructed with that server's fixed identity, and the endpoint for the server the window was showing is closed

### Requirement: Bundle acquisition by Desktop and browser hosts

Desktop SHALL obtain the workspace bundle from its pinned embedded-server artifact, launch it through the declared verification and host-context contract, and run it for every window whichever server the window shows, without requiring a network listener and without downloading a bundle from any server. A browser session SHALL obtain the bundle from the stable session origin of the server it opened, through that origin's verified asset flow. `app.terminay.com` SHALL be the connection manager only: it stores stable-origin bookmarks and frames one server's session origin for each session, and SHALL NOT open a transport to any server other than the one whose session it frames, or execute a server's workspace bundle as manager-origin script. A server UI SHALL remain usable when opened directly at its session origin.

#### Scenario: Desktop window shows a remote server

- **WHEN** a Desktop window is switched to a remote server
- **THEN** it runs the bundle from its pinned embedded-server artifact and downloads no bundle for that server

#### Scenario: Manager framing a server

- **WHEN** `app.terminay.com` opens a bookmarked server
- **THEN** it frames the stable session origin and does not execute the server's bundle as manager-origin script

#### Scenario: Browser session runs its server's bundle

- **WHEN** a browser session opens a server
- **THEN** the bundle served by that server's session origin runs the session, and no other server delivers a bundle to it

#### Scenario: Desktop launch

- **WHEN** Desktop launches a window
- **THEN** the bundle comes from the pinned embedded-server artifact and is verified through the declared contract, with no network listener opened

## REMOVED Requirements

### Requirement: Host supplies transport and presentation bridge only

**Reason**: Its text and its "Several connections in one window" scenario describe a host supplying one byte transport per connection held by a window. A window shows one server.

**Migration**: Restated for one server per window as "Host supplies one byte transport and a presentation bridge".

### Requirement: Desktop byte endpoint binds server identity

**Reason**: Its "One endpoint per attached server" scenario describes a window attaching a second server. A window shows one server.

**Migration**: Restated for one server per window as "Desktop byte endpoint is bound to the window's server".

### Requirement: Bundle acquisition per host

**Reason**: Its text and scenarios describe Desktop and browser sessions attaching further servers to a window, and the manager opening transports for them. A window shows one server.

**Migration**: Restated for one server per window as "Bundle acquisition by Desktop and browser hosts".
