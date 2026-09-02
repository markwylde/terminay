## ADDED Requirements

### Requirement: Header server control presentation
The client host SHALL present the current server connection in the header by
identity, labelling it **Local** for the embedded server or the selected
server's display label. The header MUST NOT label the control by transport, and
the narrow server-connection hand-off SHALL carry only a validated display
label alongside its fixed server id.

#### Scenario: Local connection header
- **WHEN** Desktop is bound to its embedded server
- **THEN** the header control reads **Local**

#### Scenario: Selected remote header
- **WHEN** a remote server connection is selected and its terminal transport is
  live
- **THEN** the header control reads that server's validated display label and
  never continues to read **Local**

### Requirement: Connection status is separate from activity
Connection state and activity or notification counts SHALL be presented as
independent indicators.

#### Scenario: Activity while disconnected
- **WHEN** the current connection is offline and unread activity exists
- **THEN** the activity count remains visible and distinct from the connection
  state indicator

### Requirement: Connection menu contents
The connection menu SHALL be driven by one host-neutral model exposing the
current profile and status, remembered profiles, add and import, open, focus,
switch, manage, retry, disconnect, forget, revoke, and exposure actions. Host
capability differences SHALL be the only source of variation between Desktop
and browser presentations.

#### Scenario: Shared model across hosts
- **WHEN** the same connection state is supplied to the Desktop and browser
  hosts
- **THEN** both render the same menu entries except where a host capability is
  absent

#### Scenario: Exposure requires the administrative capability
- **WHEN** the current connection is connected but the host does not declare
  the server-exposure capability
- **THEN** **Expose this server…** is absent from the menu

### Requirement: Connection diagnostics in the menu
The menu SHALL distinguish offline, relay, WebRTC route, expired, revoked,
identity mismatch, and incompatible failures as separate states.

#### Scenario: Revoked versus expired
- **WHEN** a remembered profile's credential has been revoked by the server
- **THEN** the menu reports revocation and not a generic connection failure

### Requirement: Accessible connection menu semantics
The connection menu model SHALL define stable ordering, keyboard and touch
interaction, focus wrapping, and explicit activation.

#### Scenario: Keyboard traversal
- **WHEN** the menu is open and arrow keys move past the last entry
- **THEN** focus wraps to the first entry and activation requires an explicit
  key or pointer action

### Requirement: Desktop startup and Local binding
Desktop SHALL start bound to an immutable Local connection and SHALL list
remembered remote profiles alongside it. Local MUST NOT be renameable,
forgettable, or revocable.

#### Scenario: First launch
- **WHEN** Desktop starts
- **THEN** the current connection is Local and any remembered remote profiles
  are listed as separate entries

### Requirement: Native window server binding
Selecting a connection SHALL focus an existing suitable window by default and
otherwise open a new connection window. Rebinding the current window to another
server SHALL be an explicit action. Desktop SHALL support one Local window plus
several simultaneous remote server windows without credential or state leakage
between them.

#### Scenario: Focus rather than duplicate
- **WHEN** the user selects a connection that already has an open window
- **THEN** that window is focused and no second window is created

#### Scenario: Explicit rebinding
- **WHEN** the user requests another logical view of a connection
- **THEN** an additional window is opened for it

#### Scenario: Concurrent windows stay isolated
- **WHEN** one Local and three distinct remote windows are open
- **THEN** no window can read another window's credentials or workspace state

### Requirement: Desktop connection persistence
Desktop SHALL consume deep links and pasted pairing URLs without leaving
unconsumed pairing fragments in logs, history, or profile storage.

#### Scenario: Pairing deep link
- **WHEN** a pairing URL carrying a fragment secret is opened in Desktop
- **THEN** the fragment is consumed in memory and no stored profile, log line,
  or history entry contains it

### Requirement: Web connection host scope
The browser connection host SHALL offer no Local server. It SHALL support
adding, remembering, opening, switching, managing, forgetting, and revoking
remote server connections, and SHALL present disconnected and empty,
remembered, archived, offline, expired, revoked, and unreachable states.

#### Scenario: No Local option
- **WHEN** the browser host is loaded with no remembered profiles
- **THEN** a disconnected host shell with a connect modal is shown and no Local
  server profile is offered

#### Scenario: Unreachable saved server
- **WHEN** a remembered server cannot be reached
- **THEN** the host reports the unreachable state without discarding the saved
  profile

### Requirement: Web host storage split
The browser manager origin SHALL persist non-secret profile metadata only.
Device keys and reconnect grants SHALL remain on the exact session origin. The
session origin SHALL hold a non-extractable origin-keyed reconnect proof key,
discard the pairing grant after enrollment, and keep manager `localStorage`
metadata-only.

#### Scenario: No secrets in manager storage
- **WHEN** manager storage is inspected after pairing and reconnect
- **THEN** no record contains token-like, credential, or workspace fields

#### Scenario: Reconnect after a server-only restart
- **WHEN** the server restarts and the browser reconnects
- **THEN** the saved origin-keyed proof is accepted and a fresh ticket is
  issued without requiring another pairing URL

#### Scenario: Repeat pairing for a known origin
- **WHEN** a fresh pairing completes for a session origin that already has a
  saved profile
- **THEN** the existing profile is updated in place and no duplicate
  saved-server card is created

### Requirement: Bundle content stays out of the manager origin
The manager SHALL open the selected server's bundled UI at its exact session
origin, SHALL support an explicit new-browser-tab action, and SHALL expose a
route back to connection management from a direct session without transferring
secrets.

#### Scenario: Exact-origin route-only launch
- **WHEN** the user opens a remembered server
- **THEN** the constructed URL is an exact-origin, route-only session URL and
  carries no credential material

### Requirement: Versioned source-bound host bridge
Communication between the manager and a framed session SHALL use a strict
bridge that checks both the message source and the exact origin, and SHALL
reject any other sender or payload shape.

#### Scenario: Hostile postMessage
- **WHEN** an attacker origin posts a well-formed-looking bridge message
- **THEN** the message is rejected and no host action is performed

### Requirement: Shared Connections route contract
Migration of legacy manager metadata SHALL run once against the canonical
manager origin, SHALL copy no cross-origin secret, and SHALL preserve existing
session origins and their reconnect grants. Forget and revoke SHALL keep
distinct confirmation language and require explicit confirmation.

#### Scenario: Metadata-only migration
- **WHEN** legacy manager records are migrated
- **THEN** the exact session URL is retained, origin-bound grant material
  remains usable at that origin, and manager storage never receives it

#### Scenario: Forget versus revoke
- **WHEN** the user chooses forget or revoke on a remembered profile
- **THEN** each presents distinct confirmation copy and neither proceeds
  without explicit confirmation
