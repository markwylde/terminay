## ADDED Requirements

### Requirement: Codex root rollout eligibility
Codex journal discovery SHALL admit a writable rollout as a terminal's root journal only
when its provider metadata proves it is a root CLI session. A rollout that represents an
in-process subagent, or that carries no valid root session metadata, SHALL NOT be admitted,
regardless of its modification time.

#### Scenario: Newer subagent rollout is rejected
- **WHEN** one Codex process holds both a root rollout and a more recently modified subagent
  rollout writable in the same process tree
- **THEN** the terminal binds to the root rollout and the subagent rollout is never selected

#### Scenario: Rollout without root metadata
- **WHEN** a writable rollout carries no valid root session metadata
- **THEN** discovery does not admit it as a root journal

#### Scenario: Several eligible roots
- **WHEN** more than one proven root CLI rollout is eligible for the same terminal
- **THEN** discovery selects the most recently modified eligible root, so resumed and
  branched root sessions resolve deterministically

#### Scenario: Existing safety handling is preserved
- **WHEN** a candidate journal fails path, process-tree, size, or record-format validation
- **THEN** discovery fails closed for that candidate exactly as it does for any other
  provider journal
