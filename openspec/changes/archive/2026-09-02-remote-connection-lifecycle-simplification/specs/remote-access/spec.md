## MODIFIED Requirements

### Requirement: One live connection per device

The server SHALL hold at most one live connection per device. A successful pairing or `device-join` for a device SHALL replace that device's existing peer: the host SHALL close the previous peer and complete its server-side connection cleanup before accepting the replacement. A superseded connection SHALL never outlive, mute, or tear down the resources of the connection that replaced it. Closing a connection SHALL release only what that exact connection owns — its terminal attachments, subscriptions, leases, and checkpoints — and never state belonging to another connection from the same device. Device identity SHALL govern authentication, permissions, and revocation, and SHALL NOT govern connection lifetime.

#### Scenario: Rejoin replaces the previous peer

- **WHEN** the same device joins again
- **THEN** the previous peer is closed and cleaned up before the replacement is accepted

#### Scenario: Late failure of a superseded connection is inert

- **WHEN** a superseded connection fails at any later time
- **THEN** the replacement's live stream, leases, and checkpoints are unaffected

#### Scenario: Second tab takes over

- **WHEN** the workspace is opened in a second tab at the same session origin
- **THEN** that reconnect takes the connection over and the first tab shows reconnecting
- **AND** separate devices, Desktop windows, and Local connections are unaffected

### Requirement: Explicit generation liveness signals

Generation liveness SHALL use explicit signals only. A generation SHALL fail, exactly once, when the peer or ICE connection reports `failed` or `closed`; the ICE `disconnected` grace period expires, where grace starts only when the peer is also not `connected`; a required lane (`control`, `application`, `terminal`, `assets`) leaves `open` after the handshake; the application-protocol reader ends; or the heartbeat bound is exceeded. Traffic patterns SHALL NOT be a liveness signal: quiet PTY output, hydration bursts, and outbound pauses SHALL never be classified, inferred from, or acted on.

#### Scenario: ICE blip while the peer stays connected is ignored

- **WHEN** ICE reports `disconnected` while `connectionState` remains `connected`
- **THEN** the generation is kept and live terminal output continues

#### Scenario: Grace expiry replaces the generation once

- **WHEN** the peer reports `disconnected`, or ICE reports `disconnected` while the peer is also not `connected`
- **THEN** the generation either recovers inside grace or is replaced once without a page reload

#### Scenario: Quiet output is not a failure

- **WHEN** a terminal produces no output for minutes
- **THEN** no traffic-pattern inference is made and the generation stays live

### Requirement: Heartbeat liveness

Liveness SHALL be proven by a heartbeat. The workspace client SHALL send an application-protocol ping every 10 seconds on the live generation and the server SHALL answer on the same lane. Two consecutive missed responses SHALL retire the generation and start recovery. The server SHALL close any connection with no inbound application frames for 60 seconds, so a half-open transport that never fires a close event is still reaped. A healthy but idle workspace SHALL stay connected on pings alone.

#### Scenario: Idle workspace stays connected

- **WHEN** a workspace is healthy but idle for minutes
- **THEN** the heartbeat alone keeps the connection alive

#### Scenario: Stalled transport is detected and recovered

- **WHEN** a transport stops delivering
- **THEN** a missed ping detects it and recovery completes within the heartbeat bound

#### Scenario: Half-open transport is reaped

- **WHEN** no inbound application frames arrive for 60 seconds
- **THEN** the server closes that connection

### Requirement: Live stream integrity after hydration

Live terminal output SHALL share the binary application lane with command results and later workspace events. Attach snapshots, later PTY bytes, new projects, and new terminals SHALL be the same live stream. A generation that hydrates a checkpoint but cannot decode or deliver later events SHALL be failed rather than connected. A new project or terminal created after hydrate SHALL appear on the remote view only while that generation can still deliver. Data-channel frames SHALL be `ArrayBuffer` bytes before the workspace reads them; a `Blob` SHALL be decoded in order or fail that generation visibly, and SHALL never be dropped.

#### Scenario: Hydrated-but-dead generation is failed

- **WHEN** a generation paints a terminal checkpoint but cannot stream later PTY or workspace events
- **THEN** it is treated as a recoverable transport failure and is not left mounted as connected
- **AND** connection and terminal chrome show reconnecting until the replacement generation hydrates

#### Scenario: Post-hydrate creation appears live

- **WHEN** a new project or terminal is created after hydrate on a live generation
- **THEN** it appears on the remote view

#### Scenario: Blob frames are decoded in order

- **WHEN** a data-channel frame arrives as a `Blob`
- **THEN** it is decoded in order or fails that generation visibly, and is never dropped

#### Scenario: Repeated reconnect cycles recover

- **WHEN** at least three reconnect cycles occur in a row during continuous PTY output
- **THEN** each hydrates a checkpoint and then streams new output within the heartbeat bound

