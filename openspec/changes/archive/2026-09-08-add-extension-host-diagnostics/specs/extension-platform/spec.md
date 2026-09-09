## ADDED Requirements

### Requirement: A child reports its fatal error before exiting

An extension child SHALL report a bounded fatal-error frame to its host before exiting on an uncaught exception or an unhandled rejection. The frame SHALL carry the error name, message, stack, and the exit code the child is about to use. A child SHALL NOT terminate silently on a fatal error, and a host that never receives the frame SHALL still record the exit code or signal it observed.

#### Scenario: Uncaught exception in extension code

- **WHEN** extension code throws an uncaught exception
- **THEN** the child sends its host the error name, message, stack, and exit code before the process ends

#### Scenario: Child dies before it can report

- **WHEN** a child is killed without a chance to report
- **THEN** the host still records the observed exit code or terminating signal

### Requirement: A failed host is restarted under supervision

A host whose child exits unexpectedly SHALL be restarted automatically when its computed restart backoff expires, without requiring a server or application restart. Backoff SHALL grow with consecutive failures up to the maximum, and restart attempts SHALL stop once the extension is quarantined. A restart SHALL re-publish the extension's contributions so terminals matched after it returns are admitted normally.

#### Scenario: Host crashes once during a session

- **WHEN** an extension host child exits unexpectedly while the server is running
- **THEN** the host is restarted after its backoff expires and its contributions become available again

#### Scenario: Repeated crashes

- **WHEN** failures continue past the crash threshold within the crash window
- **THEN** the extension is quarantined and no further automatic restart is attempted

#### Scenario: Agent provider returns after a crash

- **WHEN** an agent provider's host is restarted and a matching CLI is already running in a terminal
- **THEN** that terminal is re-observed and can bind without a new terminal or a new CLI process

### Requirement: Quarantine is recoverable without an application restart

An explicit restart of a quarantined extension SHALL clear its quarantine, reset its crash window, and start the host. The restart control SHALL remain available while an extension is quarantined, and a quarantined extension SHALL report that state so a person can see why it is not running.

#### Scenario: Restarting a quarantined extension

- **WHEN** a person restarts an extension shown as quarantined
- **THEN** its quarantine and crash window are cleared and the host starts

#### Scenario: Quarantined extension is visible

- **WHEN** an extension is quarantined
- **THEN** its state is reported as quarantined rather than as installed and running

## MODIFIED Requirements

### Requirement: Crash containment

One crash SHALL mark only that extension and its environments unavailable. It
MUST NOT prevent This server readiness or crash another provider. Every crash
SHALL be recorded in the local diagnostic history with the extension id, the
observed exit code or signal, and the error the child reported.

#### Scenario: Provider crash

- **WHEN** an extension host process crashes
- **THEN** only that extension and its environments are marked unavailable, and
  This server and other providers remain usable

#### Scenario: Crash leaves evidence

- **WHEN** an extension host process crashes
- **THEN** the local diagnostic history records the extension id, the exit code
  or signal, and the reported error
