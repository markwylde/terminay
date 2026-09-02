## 1. Connection-scoped teardown (server-core)

- [x] 1.1 Give every accepted connection a unique `connectionId` visible to the operation registries and verify it is present on every accepted connection in a server-core test
- [x] 1.2 Report connection cleanup as `onConnectionClosed(connectionId, clientId)` and verify both identities reach the registries
- [x] 1.3 Replace `terminalOperations.closeClient` with `closeConnection(connectionId)`, recording the owning connection at attach time, and verify attachments are released only when their own connection closes
- [x] 1.4 Apply the same connection scoping to macro operations and file observations and verify with per-registry tests
- [x] 1.5 Release presentation leases, checkpoints, and input sources through the closing connection's own attachments and verify no registry scans by device id remain
- [x] 1.6 Filter terminal presentation events by attachment ownership in event-subscription routing and verify a second connection for the same device never receives another connection's terminal lane
- [x] 1.7 Add the regression test: connection A and connection B for one device attach the same terminal, A's transport fails, B keeps streaming and keeps its lease

## 2. Join-replaces and simplified peer lifecycle (hosted host)

- [x] 2.1 Track live peers as a map keyed by device id, with pairing joins keyed on the enrolling room until a device id exists, and verify by test
- [x] 2.2 On `device-join` close the device's existing peer and await its server-connection cleanup before creating the new peer, verified by an ordering assertion
- [x] 2.3 Delete `HostedGenerationSet` and verify no caller remains
- [x] 2.4 Reduce the hosted peer lifecycle to terminal peer/ICE state, ICE `disconnected` grace, required-lane close, and explicit close, verified by lifecycle tests
- [x] 2.5 Delete the stall predicates, lane diagnostic application, stall grace constant, and the stall-classification half of the hosted stream diagnostics, verified by absence of stall events in host tests
- [x] 2.6 Keep peer/ICE transitions, channel state, frame and byte counters, and close reasons, adding `replaced-by-rejoin` and `heartbeat-timeout`, verified by diagnostic assertions
- [x] 2.7 Wire the `application` channel close to the lifecycle fail path instead of a log-only handler and verify the generation fails once

## 3. Heartbeat

- [x] 3.1 Add a metadata-only `connection.ping` operation to the server-core operation registry and verify it echoes the client timestamp
- [x] 3.2 Send a ping every 10 seconds from the workspace client on the live generation and verify with fake timers
- [x] 3.3 Retire the generation after two consecutive missed responses and verify it enters the existing reconnect state machine
- [x] 3.4 Close any connection with no inbound application frames for 60 seconds with reason `heartbeat-timeout` and verify a half-open transport is reaped
- [x] 3.5 Delete the session silence watch, its classification, and the silence-recovery branches in the web entry point and connect gate, verifying the only recovery triggers are transport/generation failure, required-lane close, heartbeat miss, and ICE grace expiry

## 4. Terminal lane correctness

- [x] 4.1 Give the protocol attachment sink an `onClose` and deliver an explicit resync-required attachment-closed event on the control class for every non-client detach, verified by test
- [x] 4.2 Make the client re-attach from a fresh checkpoint on that event through the congestion resync path and verify live output resumes
- [x] 4.3 Clear `resyncPending` when the resynchronizing attachment is replaced and on terminal release, verified by a congest/resync/stream test that runs twice on one connection
- [x] 4.4 End `outputSuppressed` when the replacement attachment attaches, and close a never-replaced suppressed attachment with the explicit event, verified by test
- [x] 4.5 Keep the 30-second writable backpressure failure and verify it now fails only the offending connection

## 5. Deletions

- [x] 5.1 Delete the headless `node-datachannel` and secure-Werift host modules and the optional headless-host wiring in server exposure, verifying the build and packaged runtime proof stay green
- [x] 5.2 Delete the orphaned outage-signaling test and the superseded generation-set, hydrated-checkpoint-silence, silent-PTY-reconnect, and node-datachannel spike tests, verifying CI stays green
- [x] 5.3 Keep the Desktop outbound peer and runtime modules and the headless session-host module, verifying their live importers still build
- [x] 5.4 Move the superseded context notes from the preceding connection tasks into this change's history trail

## 6. Werift zero-window probe

- [x] 6.1 Confirm the zero-window deadlock with evidence and move the artifact patch to its own change, verifying the heartbeat bounds the deadlock into a reconnect in the meantime

## 7. Tests and acceptance

- [x] 7.1 Server-core: two connections for one device, the old one failing late, written first because it is the exact production bug
- [x] 7.2 Hosted host: rejoin replaces the previous peer, required-lane close fails the generation once, and no stall events exist
- [x] 7.3 Heartbeat: two missed client pings cause one reconnect attempt, a connection with 60 seconds of inbound silence is reaped, and a quiet healthy terminal stays connected on pings alone
- [x] 7.4 Terminal lane: congest, explicit resync event, re-attach, live stream resumes — twice in a row on one connection, proving the latches clear
- [x] 7.5 E2E in real Electron in the container: three reconnect cycles each hydrate and then stream new output, and a reconnect during sustained PTY output resumes streaming
- [x] 7.6 Update the remote-access and terminal-stream congestion-and-recovery specifications so they describe only the new contract, verified by review against this change's deltas
