## ADDED Requirements

### Requirement: AI provider execution happens on the server machine

Provider execution SHALL happen on the server machine. Bounded context SHALL come from the server-owned terminal stream, and the adapter SHALL NOT be given a project path it cannot resolve on the server's own filesystem.

#### Scenario: Metadata request for a terminal

- **WHEN** an AI metadata request targets a terminal
- **THEN** the provider executes on the server machine using context from the server-owned terminal stream
- **AND** no path outside the server's own filesystem is passed to the adapter

## REMOVED Requirements

### Requirement: Provider execution stays on the server machine

**Reason:** Every terminal is backed by the server that owns its project, so provider execution has no alternative location to be pinned against.

**Migration:** None. The surviving execution-location and bounded-context rules are stated by "AI provider execution happens on the server machine".
