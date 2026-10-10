## ADDED Requirements

### Requirement: Secret exposure limits

Secret values MUST NOT be included in workspace snapshots, audit events, logs, or
normal settings responses. Macro execution MUST NOT resolve a vault entry and
MUST NOT write a secret value to a PTY.

#### Scenario: Snapshot contents

- **WHEN** a workspace snapshot, audit event, log line, or settings response is
  produced
- **THEN** it contains no secret values

#### Scenario: Macro execution and secrets

- **WHEN** a macro runs
- **THEN** no vault entry is resolved for it and no secret value is written to
  the PTY

## REMOVED Requirements

### Requirement: Secret exposure limits and macro resolution

**Reason**: Macros no longer resolve secret placeholders. The exposure limits on
snapshots, audit events, logs, and settings responses are unchanged and continue
under "Secret exposure limits".

**Migration**: See "Secret exposure limits". A macro that held a secret step is
preserved and does not run; see "Unsupported steps are preserved and never run"
in `macros`.
