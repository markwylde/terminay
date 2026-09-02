## ADDED Requirements

### Requirement: Exclusive user-data root
A user-data root SHALL admit exactly one live Terminay process. The host SHALL hold an
exclusive process lock in that root alongside the platform single-instance lock, and a second
process targeting the same root SHALL fail closed rather than sharing it.

#### Scenario: Second process on the same root
- **WHEN** a second Terminay process starts against a user-data root already held by a live
  process
- **THEN** it fails closed and does not open a workspace against that root

#### Scenario: Separate roots run independently
- **WHEN** two Terminay processes target different user-data roots
- **THEN** both start and each holds its own exclusive lock
