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

#### Scenario: Isolated parallel workers

- **WHEN** a shard uses multiple workers
- **THEN** each owns its virtual display, test profiles and mutable fixture state, while tests sharing setup stay ordered within one worker

#### Scenario: Native packaging requires exclusive execution

- **WHEN** a shard contains a test that rebuilds shared native modules
- **THEN** it uses one worker and its assigned load accounts for that reduced capacity

### Requirement: Five-minute run budget

CI SHALL measure and report each full pull-request or main run against an execution-critical-path target below 300 seconds after excluding runner queueing. The execution critical path SHALL be the longest sum of job execution durations along required dependency chains. Each duration SHALL include job setup, downloads, cache misses, tests, artifact transfers, reporting and teardown from job start to completion. CI SHALL separately retain original creation-to-green elapsed time and runner-wait evidence. Retries SHALL NOT reset the original creation time, conceal failed attempts or supply ambiguous evidence as proof of meeting the target. Readiness SHALL require every required check successful or legitimately skipped.

#### Scenario: Source-only change

- **WHEN** a source-only change triggers CI
- **THEN** its complete execution critical path is compared with 300 seconds and original creation-to-green elapsed time remains visible

#### Scenario: Dependency change

- **WHEN** a dependency change requires new images or downloads
- **THEN** that job execution time remains included in the execution budget and any path of 300 seconds or more is reported as a miss

#### Scenario: Runner queueing

- **WHEN** a required job waits for a runner after its dependencies are ready
- **THEN** that admission wait is excluded from the execution critical path and retained in the queue and end-to-end timing evidence

#### Scenario: Complete green run

- **WHEN** every required check completes successfully or is legitimately skipped
- **THEN** the report gives both the execution-critical-path budget result and original creation-to-green elapsed time

#### Scenario: Retry or incomplete run

- **WHEN** attempt history, dependency evidence or a required check is incomplete or ambiguous
- **THEN** the report preserves that uncertainty and does not claim the run proves the execution target

### Requirement: npm download cache stays on the runner

CI jobs that install npm dependencies SHALL retain npm's integrity-verified download cache in persistent storage owned by the runner or its execution daemon, such as a tool-cache directory or named cache volume. Jobs SHALL NOT archive, upload or download that cache as a job step, and SHALL NOT share installed node_modules trees through it.

#### Scenario: A job ends without uploading the cache

- **WHEN** a job that ran npm ci finishes
- **THEN** no step archives or uploads the npm cache

#### Scenario: A later job reuses the cache

- **WHEN** a job runs npm ci on a runner whose persistent cache contains packages from the same lockfile
- **THEN** npm verifies and reads those cached packages instead of fetching their tarballs again

## ADDED Requirements

### Requirement: Reusable revision-matched verification artifacts

CI SHALL reuse build outputs within a run where consumers require identical inputs and platform boundaries. Reuse SHALL preserve revision, architecture and glibc floor checks and all required test scenarios.

#### Scenario: Linux archive consumers

- **WHEN** multiple jobs exercise the same standalone archive
- **THEN** each receives verified bytes produced for that run's revision and supported Linux floor

#### Scenario: Independent Linux verification consumers

- **WHEN** one Linux producer has built revision-matched standalone and AppImage artifacts inside the supported floor environment
- **THEN** the floor verification and systemd restart checks depend directly on that producer and may run in parallel
- **AND** each consumer verifies transferred digests before execution and final readiness still requires both checks

### Requirement: Critical-path timing evidence

CI timing evidence SHALL report queue-excluded execution critical paths and original creation-to-green elapsed time, separate dependency and runner waits where determinable, and identify cache conditions and ambiguous retry timestamps.

#### Scenario: Slow run diagnosis

- **WHEN** a completed run exceeds the budget
- **THEN** its report names the execution-critical dependency path, slow jobs and available scheduling evidence without misclassifying retry starts as initial queue delay
