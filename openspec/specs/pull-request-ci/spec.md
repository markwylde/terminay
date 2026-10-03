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

The E2E suite SHALL be sharded by test rather than by file, so that each of the eighteen shards receives a near-equal number of tests and no shard receives none. Tests SHALL be dealt to the shards in turn, in suite order, so that a file of slow tests is spread across shards rather than filling one. A spec whose tests share setup from a `beforeAll` hook, or that declares itself one group, SHALL stay whole: its tests run in one shard, in declaration order. A test tagged `@heavy` SHALL count for several tests when shards are filled, so the shard that runs it is dealt fewer others. Every test SHALL run in exactly one shard; when the deal cannot be computed, the shard SHALL fall back to the test runner's own sharding rather than run a partial suite.

#### Scenario: No empty shard

- **WHEN** the suite is listed for each of the eighteen shards
- **THEN** every shard lists at least one test, and, counting a heavy test as several, the largest shard has no more than the smallest shard plus the size of the largest whole spec

#### Scenario: A heavy test's shard is dealt fewer tests

- **WHEN** a shard runs a test tagged `@heavy`
- **THEN** it is dealt fewer other tests than a shard that runs none

#### Scenario: A file of slow tests is spread

- **WHEN** a spec that shares no setup has several tests
- **THEN** its tests run in several shards rather than in one

#### Scenario: Shared-instance spec stays together

- **WHEN** the suite is sharded
- **THEN** all tests of a spec that uses `beforeAll` or declares itself one group are listed in the same shard

#### Scenario: A title the list cannot express

- **WHEN** two tests cannot be told apart in a shard's test list
- **THEN** the shard runs the slice the test runner's own sharding gives it, and no test is skipped

### Requirement: Per-test timing in CI logs

Each CI E2E shard SHALL record every test's duration in a machine-readable report that it keeps with the shard's artifacts, and SHALL print the slowest tests with their durations in the job log whether the tests pass or fail. Printing the summary SHALL NOT change the shard's exit status.

#### Scenario: Slowest tests appear in the log

- **WHEN** an E2E shard finishes
- **THEN** its job log lists the slowest tests in that shard with their durations, followed by the shard's original pass or fail result

### Requirement: Five-minute run budget

A full CI run for a pull request or for `main` SHALL finish within five minutes of being queued, measured from the run's creation to the completion of its last job, when its jobs start without waiting for a runner and the runners already hold the current dependency base image. A run that publishes a new dependency base image is exempt, because every runner then has to pull that image once.

#### Scenario: Source-only change

- **WHEN** a commit that leaves the dependency base image unchanged is pushed to a pull request or to `main`, and runners are free
- **THEN** every job of the run has completed within five minutes of the run being created

#### Scenario: Dependency change

- **WHEN** a commit changes an input of the dependency base image
- **THEN** the run may exceed five minutes while runners pull the new base, and the next run on those runners is within the budget

### Requirement: Independent verification runs in separate jobs

CI SHALL run work that shares no state in separate jobs or processes rather than in sequence. The unit gate and the workspace suites SHALL be separate jobs that between them run exactly the commands of `npm run test:ci`, each once. The container image smoke SHALL run all of its cases, each in its own process and on host ports no other case publishes.

#### Scenario: The unit jobs cover the local command

- **WHEN** the commands run by the unit gate job and the workspace suites job are combined
- **THEN** they are the commands of `npm run test:ci`, with none missing and none repeated

#### Scenario: Smoke cases do not collide

- **WHEN** the container image smoke runs
- **THEN** every case, including the control, runs to its own result, and no two cases publish the same host port

### Requirement: npm download cache stays on the runner

CI jobs that install npm dependencies SHALL keep npm's download cache in the runner's tool cache directory, which outlives a job, and SHALL NOT archive, upload or download that cache as a job step.

#### Scenario: A job ends without uploading the cache

- **WHEN** a job that ran `npm ci` finishes
- **THEN** no step archives or uploads the npm cache

#### Scenario: A later job reuses the cache

- **WHEN** a job runs `npm ci` on a runner where an earlier job installed the same lockfile
- **THEN** npm reads the packages from the runner's tool cache instead of the registry
