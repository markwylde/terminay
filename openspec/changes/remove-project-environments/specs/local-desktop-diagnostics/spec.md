## ADDED Requirements

### Requirement: Per-terminal resource sampling for local sessions

While a Performance Log window is open, Desktop main SHALL sample per-terminal resource usage for terminal sessions backed by the embedded Local server, reporting CPU percent, resident memory, and cumulative disk bytes read and written for each session's shell process tree, keyed by the server, project, and session identity the requesting window already holds. Sampling SHALL be bounded and SHALL fail closed: a session whose process tree cannot be read SHALL report an unavailable outcome rather than a substituted or stale value. Terminal titles, command lines, arguments, working directories, environment values, and PTY bytes SHALL NOT be collected or reported.

#### Scenario: Local terminal is sampled

- **WHEN** a terminal session backed by the embedded Local server is sampled
- **THEN** its CPU percent, resident memory, and cumulative disk bytes read and written are reported for its shell process tree
- **AND** no title, command line, argument, working directory, environment value, or PTY byte is reported

#### Scenario: Process tree cannot be read

- **WHEN** a local session's shell process tree cannot be read
- **THEN** that session reports an unavailable outcome
- **AND** no substituted or stale value is presented as a measurement

## REMOVED Requirements

### Requirement: Per-terminal local resource sampling

**Reason:** A terminal session is always backed by the server that owns its project, so sampling has no routed session to exclude and no adapter to withhold a resource-reporting request from.

**Migration:** None. The surviving sampling, fail-closed, and non-collection rules are stated by "Per-terminal resource sampling for local sessions".
