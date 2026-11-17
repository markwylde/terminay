## ADDED Requirements

### Requirement: Prerelease jobs retain the version plan through retries

Every job in a rolling prerelease attempt SHALL use the release base selected by its version planner. Retrying a build job SHALL preserve its planned version and release notes even when new stable release tags exist. A build SHALL fail if its computed version differs from its planned version.

#### Scenario: Stable release is tagged before a retry

- **WHEN** a desktop job is retried after a stable tag is added and the version planner is reused
- **THEN** the retried job uses the planner's original release base and produces the original planned version and notes

#### Scenario: No stable release exists when planning

- **WHEN** a prerelease is planned without a stable release tag and a tag is added before a build retries
- **THEN** the retry continues using the planner's no-tag base

### Requirement: Windows update-test packaging preserves build diagnostics

Preparing the Windows update-test installer SHALL report failed build stages and their exit status to the job log. It SHALL produce a valid next-version installer and update metadata before reporting success. These test artifacts SHALL remain unpublished.

#### Scenario: Packaging fails

- **WHEN** a packaging command fails while preparing the update-test installer
- **THEN** the job fails and preserves the command's diagnostics and exit status in the job log

#### Scenario: Packaging succeeds

- **WHEN** preparation succeeds
- **THEN** the test feed contains the next version's installer and metadata and the script returns only that version on standard output
