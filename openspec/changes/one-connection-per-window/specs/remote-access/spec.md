## MODIFIED Requirements

### Requirement: Recovery scope and revocation

Automatic recovery and **Retry connection** SHALL use the same reconnect operation. An expired or revoked device identity SHALL stop recovery and request pairing. Closing one browser tab or Desktop window SHALL affect only that client connection. Device revocation SHALL affect live and future connections: revoking a device SHALL close every live connection that device holds to the server, whichever window each belongs to, and SHALL refuse its later connections.

#### Scenario: Revoked device stops recovering

- **WHEN** the device identity is expired or revoked
- **THEN** recovery stops and pairing is requested

#### Scenario: Revoking one device leaves others alone

- **WHEN** one device is revoked
- **THEN** every live connection of that device closes and other devices, Local Desktop, and server-owned PTYs are unaffected

#### Scenario: Revoking a device with several windows open

- **WHEN** a device with three windows connected is revoked
- **THEN** all three connections close and none of them recovers

## ADDED Requirements

### Requirement: One live connection per client window

Each server SHALL hold at most one live connection for each client window of each device. A client window is one browser tab or one native window. A window SHALL identify itself with a window id: a random, non-secret value it keeps for as long as it lives and presents on the transport-authenticated channel together with its connection ticket, never through a signaling relay. A device MAY hold live connections from several windows to one server at once, and MAY hold connections to several servers at once.

A replacement peer SHALL be accepted only after it has completed transport authentication and consumed a valid connection ticket; the host SHALL then close the previous peer of the same device and the same window id, complete its server-side connection cleanup, and only then attach the replacement to the workspace. A replacement SHALL NOT close, mute, or disturb any other window of that device. A `device-join`, offer, or answer that has not yet authenticated SHALL NOT close, mute, or disturb any live peer. A superseded connection SHALL never outlive, mute, or tear down the resources of the connection that replaced it. Closing a connection SHALL release only what that exact connection owns — its terminal attachments, subscriptions, leases, and checkpoints — and never state belonging to another connection from the same device or to that device's connection to another server.

A connection that presents no window id SHALL be treated as the device's one unnamed window, so every such connection of a device replaces the previous one. A window id SHALL be validated as a bounded identifier and SHALL carry no authority: device identity SHALL govern authentication, permissions, and revocation, and neither device identity nor a window id SHALL govern another window's connection lifetime.

#### Scenario: A second window joins

- **WHEN** a device with one window connected authenticates from a second window with a different window id
- **THEN** both connections are live and the first window's terminals keep streaming

#### Scenario: A window reconnects

- **WHEN** a window whose connection dropped authenticates again with the same window id and consumes a valid ticket
- **THEN** that window's previous peer is closed and cleaned up before the replacement attaches to the workspace
- **AND** the device's other windows are untouched

#### Scenario: Unauthenticated join leaves the live peers alone

- **WHEN** a `device-join` for a device with live windows arrives but the joiner never authenticates
- **THEN** every live peer of that device stays connected and its terminal output continues

#### Scenario: Late failure of a superseded connection is inert

- **WHEN** a superseded connection fails at any later time
- **THEN** the replacement's live stream, leases, and checkpoints are unaffected

#### Scenario: A client that names no window

- **WHEN** two connections from one device authenticate without a window id
- **THEN** the second replaces the first

#### Scenario: A window id from another device

- **WHEN** a device authenticates with a window id that another device is using
- **THEN** the other device's connection is unaffected

### Requirement: Each client window is its own workspace client

Each live connection SHALL be a distinct client of the workspace, whether or not it shares a device with another. Terminal attachments, terminal input authority, presentation leases, presentation checkpoints, and events addressed to a client SHALL be scoped to the one window's connection, so that a window attaching to, typing into, or presenting a terminal SHALL NOT detach, silence, or take a lease from another window of the same device except by the same rules that apply between two devices. The device a connection belongs to SHALL remain available to authorization, audit, and the live-connections list.

#### Scenario: Two windows on one terminal

- **WHEN** two windows of one device attach to the same terminal
- **THEN** both receive its output, and neither attachment ends because the other began

#### Scenario: An event for one window

- **WHEN** the server addresses an event to the client that issued a request
- **THEN** only that window receives it, not the device's other windows

#### Scenario: Authorization is the device's

- **WHEN** a window issues a command
- **THEN** it is authorized by its device's identity and scope, exactly as the device's other windows are

### Requirement: Bounded live windows per device

A server SHALL hold at most eight live connections for one device. A window that authenticates when its device already holds eight SHALL be refused with a typed reason that the client presents to the person, SHALL NOT replace any live connection, and SHALL NOT be retried automatically until one of the device's windows has closed. A reconnect that replaces its own window's connection SHALL NOT count against the bound.

#### Scenario: A ninth window

- **WHEN** a device with eight live windows authenticates from a ninth
- **THEN** the ninth is refused with the reason shown, and the eight stay connected

#### Scenario: Reconnecting at the bound

- **WHEN** a device holds eight live windows and one of them reconnects
- **THEN** the reconnect replaces that window's connection and is not refused

### Requirement: Live connections are presented per device

Wherever a server's live remote connections are listed, each device SHALL appear once, with its name and the number of windows it has connected when that number is more than one. Closing a device's connections from that list SHALL close every window of that device and SHALL NOT revoke it.

#### Scenario: One device, three windows

- **WHEN** a device has three windows connected
- **THEN** the list shows that device once, with a count of three

#### Scenario: Closing from the list

- **WHEN** the person closes a device's live connections
- **THEN** every window of that device disconnects and the device stays trusted

## REMOVED Requirements

### Requirement: One live connection per device

**Reason**: A server holds one live connection per client window. Keeping one per device closed a person's other windows whenever one connected.

**Migration**: Restated as "One live connection per client window". A client that sends no window id keeps the per-device behaviour.
