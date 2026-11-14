# pull-request-ci Specification

## Purpose
How pull-request CI builds and distributes the Electron E2E test environment, shards the suite across runners, and reports where test time goes.

## Requirements

### Requirement: Layered E2E test environment

Pull-request CI SHALL build the Electron E2E test environment as two images. A dependency base image SHALL contain the operating-system packages, the installed npm dependencies, Electron, and Playwright's Chromium. It SHALL be tagged by a content hash of exactly the inputs that affect it: its Dockerfile, the lockfile, every workspace manifest it copies, and the scripts it runs. Of a manifest, only what an install reads SHALL count towards the hash: an npm script that npm does not run while installing SHALL NOT change it. A per-commit E2E image SHALL be built from that base and add only the repository source and its build outputs. CI SHALL build and publish a base image only when no image with its tag exists in the internal registry, and otherwise SHALL reuse the published one. Local E2E runs SHALL build both images with the same Dockerfiles.

#### Scenario: Source-only change reuses the base

- **WHEN** a commit changes application source but not the lockfile, workspace manifests, or base Dockerfile
- **THEN** CI reuses the existing base image, and the new E2E image shares all of the base's layers

#### Scenario: A test added to an npm script reuses the base

- **WHEN** a commit changes only a manifest's test or build scripts
- **THEN** the base image key is unchanged and CI reuses the existing base image

#### Scenario: Dependency change rebuilds the base

- **WHEN** a commit changes `package-lock.json`, a manifest's dependencies, or a script npm runs while installing
- **THEN** the base image key changes and CI builds and publishes a new base before building the E2E image

#### Scenario: Shards reuse base layers

- **WHEN** a runner that has already pulled an E2E image built on the current base pulls the next commit's E2E image
- **THEN** only the per-commit layers are downloaded

### Requirement: Runner image cleanup keeps the current base

The CI Docker cleanup step SHALL keep the newest dependency base image and the base named by the running job, and SHALL remove superseded base images, so that runners keep reusable base layers without growing without bound.

#### Scenario: Superseded base is removed

- **WHEN** a runner holds two base images and a job built on the newer one finishes
- **THEN** the cleanup step removes the older base and keeps the newer one

### Requirement: Warm browser-fixture dependency cache

The E2E image SHALL include the browser-shell fixture's committed Vite dependency cache, produced during the image build with the same configuration the fixture uses. Before any test runs, Playwright's global setup SHALL confirm that the cache is committed, building it only if it is missing. No browser-shell test SHALL start a fixture server against a cold dependency cache.

#### Scenario: Shard starts warm

- **WHEN** an E2E shard starts from the CI image
- **THEN** the global setup finds the committed dependency cache and completes without bundling dependencies

#### Scenario: Missing cache is built once

- **WHEN** the dependency cache is absent, for example in a local image built before this requirement
- **THEN** the global setup builds and commits it once before the first test

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

### Requirement: Per-test timing in CI logs

Each CI E2E shard SHALL record every test's duration in a machine-readable report that it keeps with the shard's artifacts, and SHALL print the slowest tests with their durations in the job log whether the tests pass or fail. Printing the summary SHALL NOT change the shard's exit status.

#### Scenario: Slowest tests appear in the log

- **WHEN** an E2E shard finishes
- **THEN** its job log lists the slowest tests in that shard with their durations, followed by the shard's original pass or fail result

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

### Requirement: Independent verification runs in separate jobs

CI SHALL run work that shares no state in separate jobs or processes rather than in sequence. The unit gate and the workspace suites SHALL be separate jobs that between them run exactly the commands of `npm run test:ci`, each once. The container image smoke SHALL run all of its cases, each in its own process and on host ports no other case publishes.

#### Scenario: The unit jobs cover the local command

- **WHEN** the commands run by the unit gate job and the workspace suites job are combined
- **THEN** they are the commands of `npm run test:ci`, with none missing and none repeated

#### Scenario: Smoke cases do not collide

- **WHEN** the container image smoke runs
- **THEN** every case, including the control, runs to its own result, and no two cases publish the same host port

### Requirement: npm download cache stays on the runner

CI jobs that install npm dependencies SHALL retain npm's integrity-verified download cache in persistent storage owned by the runner or its execution daemon, such as a tool-cache directory or named cache volume. Jobs SHALL NOT archive, upload or download that cache as a job step, and SHALL NOT share installed node_modules trees through it.

#### Scenario: A job ends without uploading the cache

- **WHEN** a job that ran npm ci finishes
- **THEN** no step archives or uploads the npm cache

#### Scenario: A later job reuses the cache

- **WHEN** a job runs npm ci on a runner whose persistent cache contains packages from the same lockfile
- **THEN** npm verifies and reads those cached packages instead of fetching their tarballs again

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
