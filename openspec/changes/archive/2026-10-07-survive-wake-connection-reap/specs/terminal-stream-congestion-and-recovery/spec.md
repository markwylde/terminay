## MODIFIED Requirements

### Requirement: Liveness detection by heartbeat

A checkpoint or attach snapshot without later live PTY or workspace events SHALL NOT count as a successful connection. Congestion recovery SHALL still apply when frames arrive and overwhelm a presentation lane. A transport that has gone silent while reporting open SHALL be detected by a connection heartbeat — a periodic application-protocol ping with a bounded response deadline — and SHALL NOT be inferred from PTY quietness or traffic patterns. A missed heartbeat SHALL be a transport-generation failure; an idle but responsive connection SHALL be healthy.

The server SHALL close a connection whose client promised a heartbeat and then sent nothing for the server's inbound-silence deadline. A client that made no such promise SHALL NOT be closed for silence.

A liveness deadline SHALL count only time during which the side measuring it was running. A deadline found to have elapsed across a suspension of the measuring side — the machine asleep, the process stopped, or the document frozen — SHALL NOT be treated as a missed heartbeat or as client silence. The server SHALL instead give the client one fresh inbound-silence deadline, and the client SHALL instead prove liveness immediately with a new probe. A peer that still does not answer within that fresh deadline SHALL be retired as usual. Detecting the suspension SHALL NOT add a timer; it is read from the deadline that fired.

#### Scenario: Silent transport reporting open

- **WHEN** a transport stops delivering while reporting open
- **THEN** the missed heartbeat response deadline retires the transport generation

#### Scenario: Idle responsive connection

- **WHEN** a connection is idle but answers heartbeats
- **THEN** it is healthy and is not replaced

#### Scenario: Client that promised a heartbeat goes silent

- **WHEN** a client that advertised the heartbeat sends nothing for the inbound-silence deadline while the server is running
- **THEN** the server closes that connection, and a client that never advertised the heartbeat stays connected

#### Scenario: The server's machine sleeps past the silence deadline

- **WHEN** the server is suspended for longer than the inbound-silence deadline and resumes
- **THEN** the connection is not closed on resume, the client is given one fresh deadline, and a client that answers within it stays connected

#### Scenario: A client that stays silent after the server resumes

- **WHEN** the server resumes from a suspension and the client sends nothing for the fresh deadline
- **THEN** the server closes the connection

#### Scenario: The client's document is frozen past its probe deadline

- **WHEN** a client is suspended while a probe is outstanding and resumes after that probe's deadline
- **THEN** the probe is not counted as missed, a new probe is sent immediately, and an answering connection is not replaced

#### Scenario: A dead transport after the client resumes

- **WHEN** a client resumes from a suspension and its immediate probe and the probes that follow go unanswered up to the miss limit
- **THEN** the transport generation is retired
