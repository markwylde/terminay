## ADDED Requirements

### Requirement: Layered E2E test environment

Pull-request CI SHALL build the Electron E2E test environment as two images. A dependency base image SHALL contain the operating-system packages, the installed npm dependencies, Electron, and Playwright's Chromium. It SHALL be tagged by a content hash of exactly the inputs that affect it: its Dockerfile, the lockfile, every workspace manifest it copies, and the scripts it runs. A per-commit E2E image SHALL be built from that base and add only the repository source and its build outputs. CI SHALL build and publish a base image only when no image with its tag exists in the internal registry, and otherwise SHALL reuse the published one. Local E2E runs SHALL build both images with the same Dockerfiles.

#### Scenario: Source-only change reuses the base

- **WHEN** a commit changes application source but not the lockfile, workspace manifests, or base Dockerfile
- **THEN** CI reuses the existing base image, and the new E2E image shares all of the base's layers

#### Scenario: Dependency change rebuilds the base

- **WHEN** a commit changes `package-lock.json`
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

The E2E suite SHALL be sharded by test rather than by file, so that each of the ten shards receives a near-equal number of tests and no shard receives none. A spec whose tests share one application instance created in a `beforeAll` hook SHALL declare itself one group, so its tests stay in one shard and run in declaration order.

#### Scenario: No empty shard

- **WHEN** the suite is listed for each of the ten shards
- **THEN** every shard lists at least one test, and the largest shard has no more than the smallest shard plus the size of the largest single group

#### Scenario: Shared-instance spec stays together

- **WHEN** the suite is sharded
- **THEN** all tests of a spec that declares itself one group are listed in the same shard

### Requirement: Per-test timing in CI logs

Each CI E2E shard SHALL record every test's duration in a machine-readable report that it keeps with the shard's artifacts, and SHALL print the slowest tests with their durations in the job log whether the tests pass or fail. Printing the summary SHALL NOT change the shard's exit status.

#### Scenario: Slowest tests appear in the log

- **WHEN** an E2E shard finishes
- **THEN** its job log lists the slowest tests in that shard with their durations, followed by the shard's original pass or fail result
