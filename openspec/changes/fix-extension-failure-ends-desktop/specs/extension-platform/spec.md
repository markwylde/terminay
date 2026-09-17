## MODIFIED Requirements

### Requirement: Crash containment

One crash SHALL mark only that extension unavailable. It MUST NOT prevent server
readiness or crash another provider. An extension's failure SHALL NOT end the
process that hosts it: every error its host observes from the child process,
from writing to its channel, or from terminating it SHALL be handled by the
host, however many are raised and whenever they arrive. Every crash SHALL be
recorded in the local diagnostic history with the extension id, the observed
exit code or signal, and the error the child reported.

#### Scenario: Provider crash

- **WHEN** an extension host process crashes
- **THEN** only that extension is marked unavailable, and the server and other
  providers remain usable

#### Scenario: Child dies while its host is still writing to it

- **WHEN** an extension child dies while its host has acknowledgements or
  replies still being written, and the operating system refuses those writes
- **THEN** the process hosting the extension keeps running, and the refusals
  are recorded rather than raised

#### Scenario: Crash leaves evidence

- **WHEN** an extension host process crashes
- **THEN** the local diagnostic history records the extension id, the exit code
  or signal, and the reported error

## ADDED Requirements

### Requirement: A long write queue is not a lost frame

A write to an extension channel that the channel accepted and queued SHALL be
treated as sent, on both the host and the child, even when the channel reports
that its write queue is long. Only a frame the channel refused, because it
cannot be serialized, exceeds the message limit, has no connected channel, or
was rejected by the operating system, SHALL be treated as not delivered. A
child that cannot deliver a frame SHALL say which frame and why in the error
it reports.

#### Scenario: Burst of lifecycle publications

- **WHEN** an agent provider publishes lifecycle events faster than the host
  drains its channel
- **THEN** the child keeps running, every queued frame is delivered, and no
  closed channel is recorded

#### Scenario: A frame is refused

- **WHEN** a child cannot deliver a frame to its host
- **THEN** the reported error names the frame kind and the reason it was
  refused
