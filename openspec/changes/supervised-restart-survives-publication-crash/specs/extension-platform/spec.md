## MODIFIED Requirements

### Requirement: A failed host is restarted under supervision

A host whose child exits unexpectedly SHALL be restarted automatically when its
computed restart backoff expires, without requiring a server or application
restart. Backoff SHALL grow with consecutive failures up to the maximum, and
restart attempts SHALL stop once the extension is quarantined. A restart SHALL
re-publish the extension's contributions so terminals matched after it returns
are admitted normally. A child that exits after the host reports running but
before its contributions are published SHALL be supervised on the same terms:
the host keeps its failed state and its scheduled restart, and the manager
SHALL NOT convert that failure into a deliberate stop.

#### Scenario: Host crashes once during a session

- **WHEN** an extension host child exits unexpectedly while the server is
  running
- **THEN** the host is restarted after its backoff expires and its
  contributions become available again

#### Scenario: Host crashes before its contributions are published

- **WHEN** an extension host child exits after the host reports running and
  before the manager publishes its contributions
- **THEN** the activation fails, the host stays failed with its restart
  scheduled, and the restart brings the host back and publishes its
  contributions

#### Scenario: Repeated crashes

- **WHEN** failures continue past the crash threshold within the crash window
- **THEN** the extension is quarantined and no further automatic restart is
  attempted

#### Scenario: Agent provider returns after a crash

- **WHEN** an agent provider's host is restarted and a matching CLI is already
  running in a terminal
- **THEN** that terminal is re-observed and can bind without a new terminal or
  a new CLI process
