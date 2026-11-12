## ADDED Requirements

### Requirement: Release check for a canary install

A standalone Terminay Server installed from the canary channel SHALL compare against the newest canary revision, read from the canary prerelease's release metadata, under the same timing, privacy, and failure rules as every other release check. It SHALL NOT offer a nightly or tagged release as an upgrade.

#### Scenario: Newer canary revision

- **WHEN** a `canary` install checks and the canary prerelease was built from a later revision
- **THEN** it records that a newer canary build is available

#### Scenario: Newer nightly only

- **WHEN** a `canary` install checks, the canary prerelease is its own revision, and the nightly prerelease is newer
- **THEN** it records that no upgrade is available
