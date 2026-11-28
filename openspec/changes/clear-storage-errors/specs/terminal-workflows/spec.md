## MODIFIED Requirements

### Requirement: Workflow records are durable canonical state

A workflow SHALL be persisted as canonical state under the server's data root in one file per terminal session, named by the session's identity and holding that session's workflow or none. Each change, including replacing one workflow with another and removing one, SHALL be a single durable replacement of that file keeping the previous committed copy, so that a session never has two committed workflows and never loses one without its replacement. A change SHALL be acknowledged to its caller, and published to clients, only after it is durably written. A change whose write fails SHALL leave the workflow as it was and SHALL fail the request that made it. A client protocol command whose write the server's storage refused SHALL fail with that server storage failure; every other failed write, and every failed write requested through an MCP tool, SHALL fail with `internal`. On restore, a workflow file that cannot be read, parsed, or validated SHALL be set aside with a corrupt marker and the previous committed copy used. When neither copy is valid, the terminal whose session the file names SHALL show that its workflow could not be restored and offer to remove it, that state SHALL persist across restarts until the user removes it, and the server SHALL NOT invent steps or statuses.

#### Scenario: Acknowledged update survives a crash

- **WHEN** `update_workflow_step` returns success and the server process is killed immediately afterwards while the session keeps running
- **THEN** the restarted server shows that step with the reported status

#### Scenario: Failed write

- **WHEN** an MCP tool's step update cannot be written
- **THEN** the call fails with `internal` and the step keeps its earlier status

#### Scenario: Client write refused by storage

- **WHEN** a client's workflow command cannot be written because the disk is full
- **THEN** the command fails with reason `storage_full`, the workflow is unchanged and no workflow change is published

#### Scenario: Corrupt workflow file

- **WHEN** the server restarts and a running terminal's workflow file is corrupt but its previous copy is valid
- **THEN** the corrupt file is set aside and the panel shows the workflow from the previous copy

#### Scenario: No valid copy

- **WHEN** two held terminals have workflows and both copies of only the first terminal's file are unreadable on restart
- **THEN** only the first terminal's panel says its workflow could not be restored and offers to remove it, the second terminal's workflow is restored, and the first still shows that state after another restart

#### Scenario: Crash while replacing

- **WHEN** the server is killed at any point while replacing a terminal's workflow W1 with W2
- **THEN** after restart that terminal has exactly one workflow, W1 or W2
