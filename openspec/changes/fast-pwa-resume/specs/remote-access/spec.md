## MODIFIED Requirements

### Requirement: Heartbeat liveness

Liveness SHALL be proven by a heartbeat. The workspace client SHALL send an application-protocol ping every 10 seconds on the live generation and the server SHALL answer on the same lane. Two consecutive missed responses SHALL retire the generation and start recovery. When the document is shown again after being hidden, the client SHALL send a resume probe at once with a 1.5 second deadline. The resume probe SHALL supersede any probe already in flight, and a single missed resume probe SHALL retire the generation and start recovery. The server SHALL close any connection with no inbound application frames for 60 seconds, so a half-open transport that never fires a close event is still reaped. A healthy but idle workspace SHALL stay connected on pings alone.

#### Scenario: Idle workspace stays connected

- **WHEN** a workspace is healthy but idle for minutes
- **THEN** the heartbeat alone keeps the connection alive

#### Scenario: Stalled transport is detected and recovered

- **WHEN** a transport stops delivering
- **THEN** a missed ping detects it and recovery completes within the heartbeat bound

#### Scenario: Half-open transport is reaped

- **WHEN** no inbound application frames arrive for 60 seconds
- **THEN** the server closes that connection

#### Scenario: Transport that died while hidden is found on return

- **WHEN** the app is shown again and its transport stopped delivering while hidden, with the peer still reporting `connected` and every lane still `open`
- **THEN** the resume probe misses within 1.5 seconds and recovery starts without waiting for the heartbeat interval or a second miss

#### Scenario: Live transport survives the resume probe

- **WHEN** the app is shown again and its transport still answers
- **THEN** the resume probe is answered and the generation is kept

### Requirement: Framed PWA resume

Framed PWA resume SHALL use the same reconnect operation. Hiding, freezing, or restoring the session document SHALL NOT leave a painted workspace whose inbound stream is dead. Returning to `app.terminay.com` with a saved framed session SHALL either restore a live generation or show reconnecting or an error with a deadline. A generation whose lanes stopped delivering while the document was hidden SHALL be replaced on return even when its peer still reports `connected`. The server SHALL send its offer and apply the browser's answer without waiting for server-reflexive candidate gathering to finish; reflexive candidates trickle after the offer. The iframe's reload URL SHALL remain the session bootstrap (`/v1/`) rather than a cache-only `/remote-app/` entry that cannot authenticate. Vault `credential.get` SHALL complete or fail visibly inside the host timeout.

#### Scenario: Backgrounded PWA reconnects on return

- **WHEN** the user backgrounds and returns to the installed PWA
- **THEN** the framed session reconnects or shows a bounded retryable error
- **AND** it does not remain on an indefinite loading mark

#### Scenario: Silently dead generation is replaced on return

- **WHEN** the session's lanes stop delivering without closing while the document is suspended, and the document is then resumed
- **THEN** a replacement generation is live within a few seconds of the resume, without reloading the document

#### Scenario: Unreachable STUN does not delay the handshake

- **WHEN** the server's configured STUN server cannot be reached from one of its local addresses
- **THEN** the server's offer is sent and the browser's answer is applied without waiting for that STUN query to time out

#### Scenario: Reload enters the session bootstrap

- **WHEN** a browser refresh or iOS iframe restore occurs
- **THEN** the document enters `/v1/` and runs the session host before the workspace

#### Scenario: Vault lookup is bounded

- **WHEN** the framed session requests a vaulted credential
- **THEN** the request completes or fails visibly inside the host timeout

## ADDED Requirements

### Requirement: Connection timing metrics

A server SHALL record connection timing samples only while its **Record connection timings** setting (`remoteAccess.connectionMetrics`, off by default) is on. A server that can record them SHALL advertise `connection.metrics.v1` in its hello. A workspace client connected to such a server SHALL send one sample after each first connect, each recovery, and each answered resume probe. A sample SHALL contain only:

- the kind (`connect`, `recover`, or `resume-alive`) and trigger (`initial`, `resume-probe`, `heartbeat`, `transport-closed`, or `manual`);
- the host kind (`browser` or `desktop`);
- integer millisecond durations: how long the document was hidden, from resume to loss detection, the resume probe round trip, the host's signaling, ICE, lane, device-authentication and application-authentication steps where the host reports them, the transport open, the hello, the workspace sync, and the total from loss or start to ready;
- the number of attempts and a failure class from a fixed set.

A sample SHALL NOT contain a client, device, session or server id, a hostname, an address, or any workspace content. The server SHALL validate each field against its fixed key and bounds and SHALL drop anything else. It SHALL keep at most the newest 2,000 samples in its data root and SHALL skip a corrupt line on read. A summary SHALL report the sample count, the time range, and the count, mean, p50, p95 and maximum of each duration, overall and per trigger, plus the most recent samples. Settings > Remote SHALL show the summary under the setting and SHALL be able to clear the samples.

#### Scenario: Recording is off by default

- **WHEN** a client recovers a connection on a server whose setting has never been turned on
- **THEN** no sample is stored

#### Scenario: A recovery is recorded

- **WHEN** the setting is on and the PWA recovers after a resume probe misses
- **THEN** one `recover` sample with trigger `resume-probe` is stored, carrying the hidden duration, detection time, step durations, and total

#### Scenario: Unknown fields are dropped

- **WHEN** a client sends a sample with an extra field or a string where a duration belongs
- **THEN** the extra field is not stored and the invalid duration is omitted

#### Scenario: Samples stay bounded

- **WHEN** more than 2,500 samples have been recorded
- **THEN** the store keeps the newest 2,000

#### Scenario: Summary in Settings

- **WHEN** the user opens Settings > Remote with samples recorded
- **THEN** the summary shows the count and p50 and p95 totals per trigger, and **Clear** removes every sample
