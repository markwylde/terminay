## MODIFIED Requirements

### Requirement: Balanced E2E shards

The E2E suite SHALL distribute tests across eighteen shards using recorded durations where available and deterministic fallback estimates for new tests. Tests sharing setup SHALL remain together. Every selected test SHALL run in exactly one shard. The plan SHALL validate real test identities against the runner's selection semantics. Unrepresentable titles SHALL be diagnosed explicitly rather than silently omitting coverage.

#### Scenario: Duration-balanced assignment

- **WHEN** a shard plan is generated with timing evidence
- **THEN** each independent unit is assigned deterministically to minimize estimated shard duration and every test is covered once

#### Scenario: Shared-instance spec stays together

- **WHEN** a spec shares setup or declares serial execution
- **THEN** its tests stay together in declaration order

#### Scenario: No empty shard

- **WHEN** the suite is planned for eighteen shards
- **THEN** every shard has work and every selected test belongs to exactly one shard

#### Scenario: A heavy test's shard is dealt fewer tests

- **WHEN** a test has no recorded duration and is tagged heavy
- **THEN** its conservative fallback cost exceeds an ordinary unknown test so its shard receives proportionally less other work

#### Scenario: A file of slow tests is spread

- **WHEN** independent slow tests belong to one file
- **THEN** they are distributed by estimated load across shards instead of assigned as a contiguous slice

#### Scenario: A title the list cannot express

- **WHEN** the planner cannot express a test identity
- **THEN** CI reports the invalid identity explicitly and does not report a partial suite as successful

### Requirement: Five-minute run budget

A full CI run for a pull request or main SHALL reach all required checks successful or legitimately skipped within 300 seconds from original run creation. Measurement SHALL include queueing, setup, tests, reporting and teardown. Retries SHALL NOT reset the original creation time or conceal failed attempts. Cache misses and unavailable runners SHALL be reported as budget misses, not silently excluded.

#### Scenario: Source-only change

- **WHEN** a source-only change triggers CI
- **THEN** the complete creation-to-green run is measured against 300 seconds including runner waits

#### Scenario: Dependency change

- **WHEN** a dependency change requires new images or downloads
- **THEN** that setup time is included and any run exceeding 300 seconds is reported as a budget miss

#### Scenario: Complete green run

- **WHEN** every required check completes successfully
- **THEN** the readiness report measures original creation to last completion and identifies whether it is below 300 seconds

#### Scenario: Retry or incomplete run

- **WHEN** Gitea preserves earlier jobs across retries or a required check remains pending or failed
- **THEN** the report preserves attempt context and does not claim an incomplete or over-budget run meets the target

## ADDED Requirements

### Requirement: Reusable revision-matched verification artifacts

CI SHALL reuse build outputs within a run where consumers require identical inputs and platform boundaries. Reuse SHALL preserve revision, architecture and glibc floor checks and all required test scenarios.

#### Scenario: Linux archive consumers

- **WHEN** multiple jobs exercise the same standalone archive
- **THEN** each receives verified bytes produced for that run's revision and supported Linux floor

### Requirement: Critical-path timing evidence

CI timing evidence SHALL separate dependency waits, runner waits where determinable, execution and final readiness, and identify cache conditions and ambiguous retry timestamps.

#### Scenario: Slow run diagnosis

- **WHEN** a completed run exceeds the budget
- **THEN** its report names the slowest jobs and available scheduling evidence without misclassifying retry starts as initial queue delay
