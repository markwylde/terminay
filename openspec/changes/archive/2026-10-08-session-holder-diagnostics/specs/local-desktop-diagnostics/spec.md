## ADDED Requirements

### Requirement: Session holder lifecycle is recorded

The normal diagnostic level SHALL record the embedded Local server's session-holder lifecycle so that terminals ending without the user asking can be traced to the holder event that ended them. The history SHALL distinguish: a holder found at server start-up and attached, with whether it was started by the same build, whether it is drain-only, and how many live and ended sessions it holds; a holder record removed because its process was gone; a holder that could not be spoken to and was signalled to end; a live holder that would not accept this server and was left running, with the reason it gave; a holder launched, with how long the launch took; a holder launch that failed, with the reported error; a holder marked drain-only, with the cause; the unattached limit sent to holders; the server's connection to a holder closing, with whether this server closed it, whether the holder announced it was closing, and how many live sessions that holder held; and a holder closing.

A holder-closing record SHALL carry the reason the holder gave — that it held no live session, that its unattached limit expired, that the server ended every session, that it received a termination signal (with the signal's name), that no server attached after it started, or that it failed with an uncaught error (with the reported error) — together with the number of sessions live when it closed, whether a server was attached, the unattached limit in force, and the time since a server last attached and last detached. A holder that closes while holding live sessions for any reason other than the server ending every session SHALL be recorded at warning severity, as SHALL a connection to a holder that closes without this server closing it.

#### Scenario: A server starts with a holder from an earlier launch

- **WHEN** the embedded Local server starts and finds a live holder left by an earlier launch
- **THEN** a record shows the holder attached, whether the same build started it, and how many live sessions it holds
- **AND** if the server marks it drain-only, a record shows that and the cause

#### Scenario: A holder is already serving another server

- **WHEN** the embedded Local server starts and a live holder refuses it because another server is attached
- **THEN** a warning record shows the holder was unreachable and why
- **AND** no record shows that holder attached, drained, or signalled

#### Scenario: A holder's unattached limit expires

- **WHEN** a holder closes because no server was attached for the unattached limit
- **THEN** the history holds a warning record with the limit-expired reason, the number of sessions that were live, the limit in force, and the time since a server last detached

#### Scenario: A holder is signalled while a server is attached

- **WHEN** a holder with live sessions receives a termination signal while a server is attached
- **THEN** a warning record carries the signal reason and the signal's name
- **AND** the record of the connection closing shows the holder announced it

#### Scenario: The connection to a holder drops

- **WHEN** the server's connection to a holder closes and neither the server nor the holder asked for it
- **THEN** a warning record shows an unrequested, unannounced close and the number of live sessions that holder held

#### Scenario: Hung-up terminals are investigated

- **WHEN** the history is read after terminals ended without the user closing them
- **THEN** it distinguishes a holder whose limit expired, a holder that was signalled, a holder that failed, a holder the server ended deliberately, and sessions that ended on their own while their holder kept running

### Requirement: A holder close with no server attached is recorded by the next server

A holder that closes while no server is attached cannot reach the diagnostic history itself. The embedded Local server SHALL record such a close when it next starts on the same data root, at the same severity it would have had, carrying the time the holder closed and marked as reported late. Each close SHALL be recorded once. Closes awaiting a server SHALL be bounded in number, the oldest being discarded first, and SHALL NOT be gathered by a timer or by polling.

#### Scenario: A holder closes while the application is not running

- **WHEN** a holder's unattached limit expires after Desktop has quit, and Desktop is started again
- **THEN** the history of the new launch holds the close, marked as reported late, with the time the holder closed
- **AND** a later launch does not record that close again

#### Scenario: A holder closes unattached while the application is running

- **WHEN** a holder closes while Desktop is running but not attached to it
- **THEN** the history already shows the connection to that holder closing
- **AND** the close itself is recorded when a server next starts on that data root

### Requirement: Held session ends are recorded

The normal diagnostic level SHALL record each held terminal session ending as the embedded Local server observes it, with the session's exit code, the signal that ended it when there is one, whether this server asked for the session to end, and the holder it belonged to. A session that ended while no server was attached SHALL be recorded when a server adopts it, marked as having ended unattached.

#### Scenario: A user closes a terminal

- **WHEN** the server ends a session because its terminal was closed
- **THEN** a record shows the session ended and that the server requested it

#### Scenario: A session is hung up from outside the server

- **WHEN** a held session ends by signal and the server did not request it
- **THEN** a record carries the exit code, the signal, and that the end was not requested

### Requirement: Session holder records identify by diagnostic id and process facts only

Session-holder records SHALL identify a holder by an opaque process-local diagnostic id together with its process id and the time it started, and a session by an opaque process-local diagnostic id. A holder's build SHALL be recorded as the application version and build stamp it was started with. Records SHALL NOT carry a session id, a holder generation, the holder credential, the holder socket or record path, a working directory, a shell path or command, an environment value, a terminal title, or terminal output. A path that appears inside a reported launch or holder error is part of that error and is retained.

#### Scenario: Correlating one holder within a launch

- **WHEN** attach, drain, connection, session-end, and close records for the same holder are read within one launch
- **THEN** they carry the same diagnostic id

#### Scenario: Correlating a holder across launches

- **WHEN** a close reported late is matched to the launch that attached the holder
- **THEN** the holder's process id and start time are the same in both
- **AND** neither is a credential or grants any authority

#### Scenario: A session ends

- **WHEN** a session-end record is written
- **THEN** it carries no session id, working directory, command, title, or output

### Requirement: Session holder records stay bounded

Session-holder records SHALL be written on lifecycle transitions only: no record is produced for terminal output, input, resize, flow control, or foreground-process queries. Session ends caused by one holder closing SHALL be recorded as a count on that holder's close record rather than one record per session when the holder announced the close. Session-holder records SHALL use the bounded lifecycle channel and SHALL be subject to the per-event and per-source burst bounds of this specification.

#### Scenario: A busy terminal

- **WHEN** a held session produces sustained output
- **THEN** no session-holder record is written

#### Scenario: A holder closes with many sessions

- **WHEN** a holder announces that it is closing while holding many live sessions
- **THEN** one close record carries the session count
- **AND** no per-session record is produced for that close
