## ADDED Requirements

### Requirement: Provider execution stays on the server machine
AI provider discovery and generation SHALL execute on the Terminay Server that
owns the target session. Provider-specific model catalogs, CLI commands,
environment setup, and credential injection SHALL live behind a server-owned
provider adapter. Provider credentials SHALL be resolved only inside a scoped
server-side vault callback and SHALL NOT appear in protocol payloads, snapshots,
status data, logs, or client state.

#### Scenario: Remote client requests generation
- **WHEN** a browser client asks the server to generate a tab title
- **THEN** the provider process runs on the server machine
- **AND** the client receives only the normalized result

#### Scenario: Credential never leaves the server
- **WHEN** a provider request is served
- **THEN** the credential is read inside the vault callback only
- **AND** no snapshot, status record, or log line contains it

### Requirement: Bounded generation context
Generation context SHALL be read from the server's bounded terminal replay
buffer for the exact session, never from a client emulator. The context SHALL be
bounded before it is sent to a provider, and provider output SHALL be bounded
before it is normalized.

#### Scenario: Long-running session
- **WHEN** a session has produced far more output than the context bound
- **THEN** only the bounded server replay context is sent to the provider

#### Scenario: Oversized provider output
- **WHEN** a provider returns more output than the configured bound
- **THEN** the request fails with a bounded-output error rather than
  propagating unbounded text

### Requirement: Revision-checked application
A generation request SHALL be bound to an exact panel and terminal session and
to an expected metadata revision. The result SHALL be applied only if that
target still exists and the expected revision still matches. Focus, view,
window, and connection changes between request and result SHALL NOT retarget the
write.

#### Scenario: Stale revision
- **WHEN** a generation result returns after the panel's metadata revision has
  advanced
- **THEN** the result is discarded and no metadata is written

#### Scenario: Focus changes during generation
- **WHEN** the user focuses a different terminal while generation is in flight
- **THEN** the result is still applied only to the originally requested panel
  and session, or discarded if that target is gone

#### Scenario: Target exits during generation
- **WHEN** the target session exits before the result arrives
- **THEN** the result is discarded

### Requirement: Client isolation from provider internals
Clients SHALL NOT receive provider CLI configuration, provider environment, raw
provider output, or unredacted provider errors. Provider failures SHALL be
reported to a client as a redacted, typed error.

#### Scenario: Provider process fails
- **WHEN** a provider CLI exits with an error containing environment or
  credential detail
- **THEN** the client receives a redacted typed failure

### Requirement: Bounded provider process execution
A provider process SHALL run under a bounded timeout and SHALL be cancellable.
Cancellation SHALL terminate the child process rather than abandoning it, and a
timeout SHALL be reported as a typed failure.

#### Scenario: Request cancelled
- **WHEN** a client cancels an in-flight generation
- **THEN** the provider child process is terminated

#### Scenario: Provider exceeds its deadline
- **WHEN** a provider process runs past its bounded timeout
- **THEN** it is terminated and a typed timeout error is returned
