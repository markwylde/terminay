## ADDED Requirements

### Requirement: A closed channel is not a protocol violation

Failing to write to an extension child whose channel is missing or already closed SHALL be treated as the ordinary consequence of that child ending, not as misbehaviour by the child. It SHALL NOT terminate anything, SHALL NOT be recorded as a protocol violation, and SHALL NOT count towards the crash threshold. A frame refused because it exceeds the message limit SHALL remain a protocol violation, and the two SHALL be distinguishable in the recorded diagnostic.

#### Scenario: Write after the child has gone

- **WHEN** the host tries to write to a child whose channel has closed
- **THEN** nothing is terminated, no crash is counted, and the record names a closed channel rather than a size limit

#### Scenario: Frame over the message limit

- **WHEN** the host tries to write a frame larger than the message limit
- **THEN** it is treated as a protocol violation and the record names the size limit

### Requirement: One child death counts once

A single child ending SHALL count as one failure against the crash threshold however many pending operations discover it. Work that was in flight when the child died SHALL NOT each open a new failure. The crash threshold SHALL remain a measure of repeated deaths over time rather than of how many callers observed one death.

#### Scenario: Many operations in flight when a child dies

- **WHEN** a child dies while several acknowledgements or replies are still pending
- **THEN** exactly one failure is counted and the extension is not quarantined by that single death

#### Scenario: Repeated deaths still quarantine

- **WHEN** a child dies repeatedly within the crash window
- **THEN** each death counts once and the extension is quarantined on reaching the threshold

### Requirement: The reported exit status is the one the system gave

The exit code or terminating signal the operating system reported for an extension child SHALL be recorded whenever it is observed. Host-initiated teardown SHALL NOT replace an observed exit status with one of its own, so a diagnostic reader can tell how a child actually ended.

#### Scenario: Child exits on its own

- **WHEN** a child exits without being asked to
- **THEN** the recorded exit code or signal is the one the operating system reported

#### Scenario: Host terminates an unresponsive child

- **WHEN** the host terminates a child itself
- **THEN** that is recorded as the host's own termination and does not overwrite an exit status already observed for that child
