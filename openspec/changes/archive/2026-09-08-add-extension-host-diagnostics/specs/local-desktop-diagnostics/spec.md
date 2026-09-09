## ADDED Requirements

### Requirement: Extension host lifecycle is recorded

The recorded diagnostic history SHALL distinguish every extension host lifecycle transition: child spawn, successful activation, child exit with its exit code or terminating signal, failure, scheduled restart backoff, restart attempt, quarantine, and quarantine clearing. Each record SHALL carry the extension id and, where the transition has one, the consecutive-failure count and the scheduled restart time. An extension that stops running SHALL always leave a record, whether it exited on its own, was terminated, or was stopped deliberately.

#### Scenario: Extension child dies unexpectedly

- **WHEN** an extension child process exits without being asked to stop
- **THEN** a record names the extension id, the exit code or signal, and the consecutive-failure count

#### Scenario: Extension reaches the quarantine threshold

- **WHEN** repeated failures within the crash window quarantine an extension
- **THEN** a record names the extension id and the failure count that caused quarantine

#### Scenario: Reading the history after agents stop appearing

- **WHEN** the diagnostic history is inspected after an agent provider stopped binding terminals
- **THEN** the history shows when that extension's host last started, why it stopped, and whether it was restarted or quarantined

### Requirement: Extension failures record the error verbatim

An extension is a trusted Node program and the diagnostic history is local and never uploaded automatically, so an extension failure record SHALL carry the reported error's name, message, and stack exactly as the extension reported them, without truncation, redaction, or path rewriting. This SHALL NOT extend to terminal output, provider journal records, prompts, tool inputs or results, or credentials, which remain excluded from diagnostics.

#### Scenario: Uncaught exception inside an extension

- **WHEN** an extension child fails with an uncaught exception or unhandled rejection
- **THEN** the record carries the error name, message, and full stack as reported

#### Scenario: Failure inside a provider that reads a journal

- **WHEN** the failing extension was reading a provider journal
- **THEN** the record carries the error but no journal record, prompt, tool input, tool result, or terminal output

### Requirement: Agent observation lifecycle is recorded

The recorded diagnostic history SHALL distinguish agent observation outcomes for a terminal: provider match, admission success, admission failure, session binding, and observer release. Each record SHALL carry the provider id, the opaque terminal identity, and — for a failure — its coarse failure class together with the error the provider reported. Records SHALL NOT carry journal contents, prompts, tool inputs or results, filesystem paths belonging to the observed project, or credentials.

#### Scenario: Terminal never binds an agent

- **WHEN** a matched provider never binds a session for a terminal
- **THEN** the history distinguishes a provider that was never matched, an admission that failed, and an admission that succeeded without binding

#### Scenario: Admission fails inside the provider

- **WHEN** a provider's terminal admission fails with an error
- **THEN** the record carries the provider id, the opaque terminal identity, the failure class, and the reported error

## MODIFIED Requirements

### Requirement: Untrusted text sanitization and correlation ids

Known errors SHALL be logged as stable event names and bounded error categories. Arbitrary renderer, child-process, and provider text SHALL be treated as untrusted: length-bounded, control-character escaped, and passed through the common secret sanitizer before persistence. The sanitizer SHALL reduce URLs and secret-shaped values, and SHALL retain filesystem paths: a stack whose file names have been removed cannot be read back to the code that threw, and the history it is written to is local, permission-restricted, and never uploaded automatically. Sanitization is defence in depth; callers remain responsible for emitting metadata rather than user content. Opaque process-local diagnostic ids MAY correlate a window, `WebContents`, connection, or terminal lifecycle within one launch; durable credentials and raw authority-bearing ids SHALL NOT be diagnostic correlation keys.

#### Scenario: Provider text containing a secret

- **WHEN** provider or child-process text containing a secret is emitted
- **THEN** it is length-bounded, control-character escaped, and sanitized before persistence

#### Scenario: A stack naming the code that threw

- **WHEN** an error stack containing absolute file paths is recorded
- **THEN** those paths are retained so the failing file and line remain readable
- **AND** the record is still one parseable line

#### Scenario: Correlating a lifecycle

- **WHEN** a window, `WebContents`, connection, or terminal lifecycle is correlated across events in one launch
- **THEN** an opaque process-local diagnostic id is used
- **AND** no durable credential or raw authority-bearing id is used as the correlation key

### Requirement: Content exclusions

Normal and failure logging SHALL exclude PTY output, typed or pasted input, terminal scrollback, recordings, and terminal titles derived from commands; file contents, diffs, clipboard contents, dictation audio/transcripts, and screenshots; project roots, current working directories, user-selected filenames, home directory, usernames, hostnames, and environment-variable values as recorded fields of their own; pairing links, URL query strings/fragments, PINs, device private keys, cookies, authorization headers, API keys, vault values, and secret-bearing provider errors; and raw application-protocol, WebRTC, MCP, Git, or network payloads. A path that appears inside a recorded error message or stack is part of that error and SHALL be retained.

#### Scenario: Sensitive fixtures

- **WHEN** fixtures containing terminal text, URL credentials and fragments, authorization values, pairing material, API keys, and provider secrets are exercised
- **THEN** none of those values persist in logs or crash annotations

#### Scenario: Path inside a reported error

- **WHEN** an error message or stack names the file that produced it
- **THEN** that path is recorded as part of the error rather than removed
