## MODIFIED Requirements

### Requirement: Library sessions map to bounded snapshots

The extension SHALL publish only live library sessions: those with a `pid`. Each snapshot SHALL carry:

- the library session id and the mapped harness
- `pid` and `cwd`
- the effective title and `model`
- `status` and `waitingFor`, except that a library `waiting` whose `waitingFor` is `shell`, `monitor`, `task`, or `subagent` — a turn that ended while background work it started is still running — SHALL be `running` with no `waitingFor`, because no user input is requested
- the current tool name, the last-turn outcome and end time, and the bounded `activity.error`
- the session's subagents, each with its id, parent id, type, title, and status

The last-turn end time SHALL be published in whole epoch milliseconds: a library end time with a fractional part SHALL be rounded down to the millisecond. An end time that is not a finite number, or that rounds down to a value below zero or above the largest safe integer, SHALL be omitted from the snapshot rather than published, so that no library timestamp can make the host refuse a publication.

`session:create`, `session:open`, `session:status`, `session:update`, `session:activity`, `subagent:start`, and `subagent:end` SHALL publish an upsert. `session:close` SHALL publish a removal. Catch-up events SHALL be collected and published as one reset when `ready` fires. Transcript, event-stream, and raw record content SHALL never be published. A library `error` event SHALL be reported as a typed extension diagnostic without paths or conversation content, and SHALL NOT stop the source.

#### Scenario: Catch-up at start

- **WHEN** the library starts with three live sessions and then emits `ready`
- **THEN** the extension publishes one reset containing those three sessions

#### Scenario: Session waits on a background shell

- **WHEN** the library reports a session `waiting` with `waitingFor` `shell`
- **THEN** the extension publishes it as `running` with no `waitingFor`

#### Scenario: Antigravity session waits on background work

- **WHEN** the library reports an Antigravity session `waiting` with `waitingFor` `task` or `subagent`
- **THEN** the extension publishes it as `running` with no `waitingFor`

#### Scenario: Antigravity session asks for approval

- **WHEN** the library reports an Antigravity session `waiting` with `waitingFor` `approval`
- **THEN** the extension publishes it as `waiting` with `waitingFor` `approval`

#### Scenario: Sub-millisecond turn end time

- **WHEN** the library reports a live Antigravity session whose last turn ended at `1795772970190.7083`
- **THEN** the extension publishes its last-turn end time as `1795772970190`
- **AND** the host accepts the publication

#### Scenario: Sub-millisecond end time in the catch-up reset

- **WHEN** the catch-up reset holds a Claude Code session and an Antigravity session whose last turn ended at a fractional millisecond
- **THEN** the host accepts the reset and both sessions are published

#### Scenario: Unusable turn end time

- **WHEN** the library reports a last-turn end time that is `NaN`, infinite, negative, or larger than the largest safe integer
- **THEN** the extension publishes the session without a last-turn end time

#### Scenario: Session closes

- **WHEN** the library emits `session:close`
- **THEN** the extension publishes a removal for that session id

#### Scenario: Historical session

- **WHEN** the library knows a session with no `pid`
- **THEN** it is not published

#### Scenario: Provider error

- **WHEN** the library emits a provider error
- **THEN** a typed diagnostic is recorded and other sessions continue to be published
