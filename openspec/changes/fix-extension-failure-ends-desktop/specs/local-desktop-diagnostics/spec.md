## MODIFIED Requirements

### Requirement: Extension host lifecycle is recorded

The recorded diagnostic history SHALL distinguish every extension host lifecycle transition: child spawn, successful activation, child exit with its exit code or terminating signal, failure, scheduled restart backoff, restart attempt, quarantine, and quarantine clearing. It SHALL also record an error event raised by an extension child process, and the first write to a child that the operating system refused, each with its system error code where one exists. Each record SHALL carry the extension id and, where the transition has one, the consecutive-failure count and the scheduled restart time. A child exit record SHALL carry how many writes to that child were refused and how many calls and lifecycle publications were still outstanding. An extension that stops running SHALL always leave a record, whether it exited on its own, was terminated, or was stopped deliberately.

#### Scenario: Extension child dies unexpectedly

- **WHEN** an extension child process exits without being asked to stop
- **THEN** a record names the extension id, the exit code or signal, and the consecutive-failure count

#### Scenario: Writes to a dead child are refused

- **WHEN** the operating system refuses writes to an extension child that has died
- **THEN** one record names the extension id and the system error code, and the child's exit record carries the number of refused writes

#### Scenario: Extension reaches the quarantine threshold

- **WHEN** repeated failures within the crash window quarantine an extension
- **THEN** a record names the extension id and the failure count that caused quarantine

#### Scenario: Reading the history after agents stop appearing

- **WHEN** the diagnostic history is inspected after an agent provider stopped binding terminals
- **THEN** the history shows when that extension's host last started, why it stopped, and whether it was restarted or quarantined

### Requirement: Untrusted text sanitization and correlation ids

Known errors SHALL be logged as stable event names and bounded error categories. Arbitrary renderer, child-process, and provider text SHALL be treated as untrusted: length-bounded, control-character escaped, and passed through the common secret sanitizer before persistence. The sanitizer SHALL reduce URLs and secret-shaped values, and SHALL retain filesystem paths: a stack whose file names have been removed cannot be read back to the code that threw, and the history it is written to is local, permission-restricted, and never uploaded automatically. A `file:` URL is a filesystem path and SHALL keep its path, with any query or fragment removed. Sanitization is defence in depth; callers remain responsible for emitting metadata rather than user content. Opaque process-local diagnostic ids MAY correlate a window, `WebContents`, connection, or terminal lifecycle within one launch; durable credentials and raw authority-bearing ids SHALL NOT be diagnostic correlation keys.

#### Scenario: Provider text containing a secret

- **WHEN** provider or child-process text containing a secret is emitted
- **THEN** it is length-bounded, control-character escaped, and sanitized before persistence

#### Scenario: A stack naming the code that threw

- **WHEN** an error stack containing absolute file paths is recorded
- **THEN** those paths are retained so the failing file and line remain readable
- **AND** the record is still one parseable line

#### Scenario: A stack from an ES module

- **WHEN** an error stack names its frames by `file:` URL
- **THEN** each URL's path, line, and column are retained
- **AND** any other URL in the same text is still reduced

#### Scenario: Correlating a lifecycle

- **WHEN** a window, `WebContents`, connection, or terminal lifecycle is correlated across events in one launch
- **THEN** an opaque process-local diagnostic id is used
- **AND** no durable credential or raw authority-bearing id is used as the correlation key
