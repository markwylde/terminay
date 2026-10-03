## MODIFIED Requirements

### Requirement: Server-owned session lifetime

PTYs and server-side agents SHALL be owned by the server, not by a renderer, browser tab, Electron window, or individual transport connection, and SHALL continue running through client disconnect, reload, window close, and temporary network loss. A client SHALL be able to resubscribe using session identity and output position without duplicating the PTY or replaying already acknowledged output. An explicit terminal-close command SHALL end the PTY for all clients. PTYs SHALL continue running through a server-process restart and SHALL be reattached by the next server on the same data root. A PTY that is no longer running when the server restarts SHALL be recorded as ended, and durable workspace state SHALL NOT present an ended process as live. PTY survival across a machine restart SHALL NOT be promised.

#### Scenario: All clients disconnect

- **WHEN** every client closes
- **THEN** active PTYs keep running and the server stays alive

#### Scenario: Resubscribing

- **WHEN** a client resubscribes with a session identity and output position
- **THEN** the PTY is not duplicated and already acknowledged output is not replayed

#### Scenario: Explicit close

- **WHEN** a client issues an explicit terminal-close command
- **THEN** the PTY ends for all clients

#### Scenario: Server restart

- **WHEN** the server process restarts while PTYs are running
- **THEN** the PTYs keep running and the restarted server reattaches to them

#### Scenario: PTY ended before the server returned

- **WHEN** the server process restarts and a formerly live PTY is no longer running
- **THEN** durable workspace state records that it ended and does not present it as live

### Requirement: Non-goals

Terminay SHALL NOT provide cloud storage or proxying of workspace and application data, an independent latest workspace application at `app.terminay.com`, a requirement that Local connections use WebRTC, peer-to-peer collaborative text editing, or a promise that PTYs survive a machine restart.

#### Scenario: Local connection transport choice

- **WHEN** a Local connection is established
- **THEN** WebRTC is not required

#### Scenario: Workspace data storage

- **WHEN** workspace or application data is persisted
- **THEN** it is stored by the server that owns it and not in cloud storage or proxied through hosted infrastructure
