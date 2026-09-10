## MODIFIED Requirements

### Requirement: Ownership boundaries

Terminay Server SHALL own pairing policy, device registration, public device keys, revocation, pending pairing approvals, application authorization, workspace state, audit history, and the private host key for its session origin. The stable session origin SHALL own browser pairing, WebRTC lifecycle, server-bundle installation for the session it is the primary connection of, reconnect, match-code display, and challenge signing. `app.terminay.com` SHALL own the browser's list of manager profiles, the framed session iframe, the origin-keyed device-credential vault, and the transports it opens for servers attached to the framed primary, handing the framed primary one opaque byte endpoint per attached server, and SHALL NOT own approval, WebRTC signing for another origin's credential, or the workspace. First pairing with any server SHALL happen at that server's own stable session origin. The signaling service SHALL route authenticated WebRTC offers, answers, and ICE candidates for one server session and is untrusted for confidentiality and integrity. TURN MAY relay encrypted WebRTC packets and SHALL NOT terminate the Terminay application protocol.

#### Scenario: Manager does not run the workspace

- **WHEN** a user is on `app.terminay.com`
- **THEN** the manager stores bookmarks, frames session origins, holds framed-session credentials, and opens attached transports
- **AND** it does not show match codes or render the workspace

#### Scenario: Signaling admits only authorized parties

- **WHEN** a client attempts to join a pairing room
- **THEN** signaling admits it only with the fragment-derived join credential
- **AND** signaling admits a reconnect host only when that host proves the registered server host key

#### Scenario: Signaling cannot substitute an endpoint

- **WHEN** the signaling service substitutes or proxies a WebRTC endpoint
- **THEN** client verification fails and no application data is exchanged

#### Scenario: Attached transport keeps its credential in the manager

- **WHEN** the framed primary asks the manager to attach another saved server
- **THEN** the manager opens that server's transport with the vaulted credential for that origin and returns an opaque byte endpoint, and the primary origin's code never holds that credential

### Requirement: Closed framed-host message schema

The framed host SHALL use one closed, origin-checked `postMessage` schema for device credentials, clipboard, microphone, notifications, shell control, and connection control. Connection control SHALL be limited to listing saved connection profiles with status, opening a connection and transferring an opaque byte endpoint, closing a connection, and status notifications for open connections. It SHALL NOT proxy WebRTC, workspace frames, or generic storage. The manager SHALL key vault entries only by `event.origin` and SHALL clone a credential only into the iframe that matches that origin, and SHALL never hand a credential for one origin to the code of another. Structured clone SHALL keep the key non-extractable. The manager SHALL never sign. The session SHALL speak to `parent` only when `parent.origin` is `https://app.terminay.com` and SHALL ignore any other embedder.

#### Scenario: Vault entry is origin-keyed

- **WHEN** a session iframe requests a device credential
- **THEN** the manager resolves the vault slot only from `event.origin` and clones only into the matching iframe
- **AND** an iframe cannot name another origin's slot

#### Scenario: Session ignores foreign embedders

- **WHEN** a session document is embedded by an origin other than `https://app.terminay.com`
- **THEN** it posts nothing to `parent` and ignores that embedder

#### Scenario: Manager never signs

- **WHEN** a challenge must be signed
- **THEN** the session iframe signs it and the manager does not

#### Scenario: Open returns bytes, not credentials

- **WHEN** the framed session sends an open-connection message for a saved server
- **THEN** the manager transfers an opaque byte endpoint and sends status updates, and no credential, ticket, or WebRTC state crosses the schema

### Requirement: Server-bundled workspace delivery

The server distribution SHALL contain the complete responsive workspace UI and its matching application-protocol client. The stable session origin of a browser session's primary connection SHALL authenticate the device, obtain that server's bundle through the WebRTC asset lane, validate its declared contract and resource bounds, and launch it under that same origin as the session's one workspace UI. A server attached to that session SHALL authenticate the device and carry application traffic without delivering a bundle. `app.terminay.com` SHALL contain the connection manager only; Desktop and browser hosts SHALL NOT supply another workspace implementation or interpret feature-level application messages.

#### Scenario: Bundle launches at the session origin

- **WHEN** a device authenticates to the stable session origin of its primary connection
- **THEN** that server's bundle is transferred over the asset lane, validated, and launched under that same origin

#### Scenario: Hosts do not interpret application messages

- **WHEN** a host shell relays application traffic
- **THEN** it does not interpret feature-level application messages or supply an alternative workspace

#### Scenario: Attached server delivers no bundle

- **WHEN** a server is attached to an existing session
- **THEN** it authenticates the device and carries application traffic, and transfers no bundle

### Requirement: Single connection generation per mounted workspace

The stable session origin SHALL own one WebRTC connection generation per connection it holds. Network loss on a connection SHALL keep that server's PTYs and work running. The browser SHALL show reconnecting state for that connection, create a fresh authenticated generation, restore its subscriptions, and enable its input only after hydration completes, leaving the window's other connections untouched. The session host SHALL create one generation per connect attempt per connection, shared by pairing or saved-device signaling, bundle install where it applies, and that connection's application `connect`. The workspace SHALL NOT start a second signaling join, peer, or ticket for the same attempt. A `closed` event from a retired generation SHALL NOT start a parallel connect. Automatic recovery, **Retry connection**, document resume, and the initial connect SHALL share one in-flight attempt per connection.

#### Scenario: Input stays disabled until hydration

- **WHEN** a replacement generation for one connection is still hydrating
- **THEN** reconnecting state is shown for that connection and its terminal input remains disabled

#### Scenario: Retired generation cannot fork a connect

- **WHEN** a retired generation emits `closed`
- **THEN** no parallel connect attempt starts

#### Scenario: One connection's loss leaves the others alone

- **WHEN** one connection in a window loses its generation
- **THEN** the window's other connections keep their generations, subscriptions, and input

### Requirement: One live connection per device

Each server SHALL hold at most one live connection per device, so one device MAY hold one live connection to each of several servers at once. A replacement peer for a device SHALL be accepted only after it has completed transport authentication and consumed a valid connection ticket; the host SHALL then close the previous peer and complete its server-side connection cleanup before attaching the replacement to the workspace. A `device-join`, offer, or answer that has not yet authenticated SHALL NOT close, mute, or disturb the device's existing live peer. A superseded connection SHALL never outlive, mute, or tear down the resources of the connection that replaced it. Closing a connection SHALL release only what that exact connection owns — its terminal attachments, subscriptions, leases, and checkpoints — and never state belonging to another connection from the same device or to that device's connection to another server. Device identity SHALL govern authentication, permissions, and revocation, and SHALL NOT govern connection lifetime.

#### Scenario: Rejoin replaces the previous peer

- **WHEN** the same device joins the same server again and its replacement peer consumes a valid ticket
- **THEN** the previous peer is closed and cleaned up before the replacement attaches to the workspace

#### Scenario: Unauthenticated join leaves the live peer alone

- **WHEN** a `device-join` for a live device arrives but the joiner never authenticates
- **THEN** the live peer stays connected and its terminal output continues

#### Scenario: Late failure of a superseded connection is inert

- **WHEN** a superseded connection fails at any later time
- **THEN** the replacement's live stream, leases, and checkpoints are unaffected

#### Scenario: Second tab takes over

- **WHEN** the workspace is opened in a second tab at the same session origin
- **THEN** that reconnect takes the connection over and the first tab shows reconnecting
- **AND** separate devices, Desktop windows, Local connections, and that device's connections to other servers are unaffected

### Requirement: Desktop remote-code containment

Remote server code inside Desktop SHALL have no Node integration and no generic preload authority. Desktop SHALL run one workspace bundle per window and reach every server through its own opaque byte endpoint, and that bundle SHALL stay sandboxed and origin-bound regardless of how many connections it holds. Browser private keys SHALL be non-extractable; a first-party session document SHALL bind them to that session origin and a framed PWA session SHALL bind them to the manager vault slot for that exact origin. Full-control remote access SHALL be treated as equivalent to interactive shell access to the Terminay Server that connection reaches.

#### Scenario: Remote bundle has no Node access

- **WHEN** a server bundle runs inside Desktop
- **THEN** it has no Node integration and no generic preload authority

#### Scenario: Keys are non-extractable

- **WHEN** a browser device key is created
- **THEN** it is non-extractable and bound to its origin or vault slot

#### Scenario: Many connections stay inside one sandbox

- **WHEN** a Desktop window holds several server connections
- **THEN** its one bundle stays sandboxed and origin-bound and reaches each server only through that server's byte endpoint

### Requirement: Consistent workspace across clients

Local Desktop, remote Desktop, and browser clients connected to one server SHALL observe that server's same workspace and terminal sessions, whether that server is their primary or an attached connection. Network interruption SHALL reconnect without duplicating PTYs or workspace mutations.

#### Scenario: Same workspace on every client

- **WHEN** Local Desktop, remote Desktop, and a browser connect to one server
- **THEN** they observe that server's same workspace and terminal sessions

#### Scenario: Interruption does not duplicate state

- **WHEN** a network interruption is recovered
- **THEN** no PTY or workspace mutation is duplicated

#### Scenario: Attached and primary see one workspace

- **WHEN** one client holds a server as its primary connection while another holds it as an attached connection
- **THEN** both observe that server's same workspace and terminal sessions
