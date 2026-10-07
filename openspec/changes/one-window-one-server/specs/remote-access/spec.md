## MODIFIED Requirements

### Requirement: Single connection generation per mounted workspace

The stable session origin SHALL own one WebRTC connection generation for the connection to its server. Network loss on that connection SHALL keep the server's PTYs and work running. The browser SHALL show reconnecting state for the whole session, create a fresh authenticated generation, restore its subscriptions, and enable its input only after hydration completes, leaving sessions and windows that show other servers untouched. The session host SHALL create one generation per connect attempt, shared by pairing or saved-device signaling, bundle install where it applies, and the application `connect`. The workspace SHALL NOT start a second signaling join, peer, or ticket for the same attempt. A `closed` event from a retired generation SHALL NOT start a parallel connect. Automatic recovery, **Retry connection**, document resume, and the initial connect SHALL share one in-flight attempt.

#### Scenario: Input stays disabled until hydration

- **WHEN** a replacement generation is still hydrating
- **THEN** reconnecting state is shown for the session and its terminal input remains disabled

#### Scenario: Retired generation cannot fork a connect

- **WHEN** a retired generation emits `closed`
- **THEN** no parallel connect attempt starts

#### Scenario: One connection's loss leaves the others alone

- **WHEN** a session showing one server loses its generation while the same device has another session or window open on a different server
- **THEN** the other session or window keeps its generation, subscriptions, and input

## ADDED Requirements

### Requirement: Remote access ownership boundaries

Terminay Server SHALL own pairing policy, device registration, public device keys, revocation, pending pairing approvals, application authorization, workspace state, audit history, and the private host key for its session origin. The stable session origin SHALL own browser pairing, WebRTC lifecycle, server-bundle installation for the session it serves, reconnect, match-code display, and challenge signing. `app.terminay.com` SHALL own the browser's list of manager profiles, the framed session iframe, and the origin-keyed device-credential vault, and SHALL NOT own approval, WebRTC signing for another origin's credential, a transport to any server other than the one whose session it frames, or the workspace. The manager SHALL frame one session for one server, and the framed session SHALL reach only that server. First pairing with any server SHALL happen at that server's own stable session origin. The signaling service SHALL route authenticated WebRTC offers, answers, and ICE candidates for one server session and is untrusted for confidentiality and integrity. TURN MAY relay encrypted WebRTC packets and SHALL NOT terminate the Terminay application protocol.

#### Scenario: Manager does not run the workspace

- **WHEN** a user is on `app.terminay.com`
- **THEN** the manager stores bookmarks, frames session origins, and holds framed-session credentials
- **AND** it does not show match codes or render the workspace

#### Scenario: Signaling admits only authorized parties

- **WHEN** a client attempts to join a pairing room
- **THEN** signaling admits it only with the fragment-derived join credential
- **AND** signaling admits a reconnect host only when that host proves the registered server host key

#### Scenario: Signaling cannot substitute an endpoint

- **WHEN** the signaling service substitutes or proxies a WebRTC endpoint
- **THEN** client verification fails and no application data is exchanged

#### Scenario: Manager frames one session for one server

- **WHEN** the user opens a saved profile in the manager
- **THEN** the manager frames that server's session origin and opens no transport to that server or to any other saved server

### Requirement: Framed-host message schema is closed

The framed host SHALL use one closed, origin-checked `postMessage` schema for device credentials, clipboard, microphone, notifications, and shell control. It SHALL NOT proxy WebRTC, workspace frames, or generic storage, and SHALL NOT carry a message that lists the manager's saved profiles, opens or closes a connection to a server, transfers a byte endpoint, or reports another server's connection status. The manager SHALL key vault entries only by `event.origin` and SHALL clone a credential only into the iframe that matches that origin, and SHALL never hand a credential for one origin to the code of another. Structured clone SHALL keep the key non-extractable. The manager SHALL never sign. The session SHALL speak to `parent` only when `parent.origin` is `https://app.terminay.com` and SHALL ignore any other embedder.

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

#### Scenario: Schema carries no connection control

- **WHEN** a framed session posts a message asking the manager to list saved servers or to open a connection to one
- **THEN** the manager rejects it as outside the schema, and no profile list, byte endpoint, credential, ticket, or WebRTC state is returned

### Requirement: Server-bundled workspace delivery at the session origin

The server distribution SHALL contain the complete responsive workspace UI and its matching application-protocol client. The stable session origin of the server a browser session opened SHALL authenticate the device, obtain that server's bundle through the WebRTC asset lane, validate its declared contract and resource bounds, and launch it under that same origin as the session's one workspace UI. A browser session SHALL receive a bundle from no other server. `app.terminay.com` SHALL contain the connection manager only; Desktop and browser hosts SHALL NOT supply another workspace implementation or interpret feature-level application messages.

#### Scenario: Bundle launches at the session origin

- **WHEN** a device authenticates to the stable session origin of the server it opened
- **THEN** that server's bundle is transferred over the asset lane, validated, and launched under that same origin

#### Scenario: Hosts do not interpret application messages

- **WHEN** a host shell relays application traffic
- **THEN** it does not interpret feature-level application messages or supply an alternative workspace

#### Scenario: One server delivers the session's bundle

- **WHEN** a browser session is running
- **THEN** its workspace UI is the bundle of the server it opened, and it holds a connection to no other server

### Requirement: Desktop contains remote server code

Remote server code inside Desktop SHALL have no Node integration and no generic preload authority. Desktop SHALL run one workspace bundle per window and reach the window's server through one opaque byte endpoint, and that bundle SHALL stay sandboxed and origin-bound whichever server the window shows. Browser private keys SHALL be non-extractable; a first-party session document SHALL bind them to that session origin and a framed PWA session SHALL bind them to the manager vault slot for that exact origin. Full-control remote access SHALL be treated as equivalent to interactive shell access to the Terminay Server that connection reaches.

#### Scenario: Remote bundle has no Node access

- **WHEN** a server bundle runs inside Desktop
- **THEN** it has no Node integration and no generic preload authority

#### Scenario: Keys are non-extractable

- **WHEN** a browser device key is created
- **THEN** it is non-extractable and bound to its origin or vault slot

#### Scenario: A remote window stays inside one sandbox

- **WHEN** a Desktop window shows a remote server
- **THEN** its one bundle stays sandboxed and origin-bound and reaches that server only through the window's byte endpoint

#### Scenario: Windows showing different servers

- **WHEN** two Desktop windows show two different servers
- **THEN** each window's bundle reaches only its own server and holds no endpoint for the other

### Requirement: One workspace for every client of a server

Local Desktop, remote Desktop, and browser clients connected to one server SHALL observe that server's same workspace and terminal sessions. Network interruption SHALL reconnect without duplicating PTYs or workspace mutations.

#### Scenario: Same workspace on every client

- **WHEN** Local Desktop, remote Desktop, and a browser connect to one server
- **THEN** they observe that server's same workspace and terminal sessions

#### Scenario: Interruption does not duplicate state

- **WHEN** a network interruption is recovered
- **THEN** no PTY or workspace mutation is duplicated

#### Scenario: A window switched to a server sees the same workspace

- **WHEN** one client's window is switched to a server that another client already shows
- **THEN** both observe that server's same workspace and terminal sessions

## REMOVED Requirements

### Requirement: Ownership boundaries

**Reason**: Its text and its "Attached transport keeps its credential in the manager" scenario describe the manager opening transports for servers attached to a framed primary connection. A window shows one server.

**Migration**: Restated for one server per window as "Remote access ownership boundaries".

### Requirement: Closed framed-host message schema

**Reason**: Its text and its "Open returns bytes, not credentials" scenario describe connection control for attached servers, which a session showing one server has no use for.

**Migration**: Restated for one server per window as "Framed-host message schema is closed".

### Requirement: Server-bundled workspace delivery

**Reason**: Its text and its "Attached server delivers no bundle" scenario describe a session holding a primary connection and attached servers. A window shows one server.

**Migration**: Restated for one server per window as "Server-bundled workspace delivery at the session origin".

### Requirement: Desktop remote-code containment

**Reason**: Its text and its "Many connections stay inside one sandbox" scenario describe a Desktop window holding several server connections. A window shows one server.

**Migration**: Restated for one server per window as "Desktop contains remote server code".

### Requirement: Consistent workspace across clients

**Reason**: Its text and its "Attached and primary see one workspace" scenario distinguish primary and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "One workspace for every client of a server".
