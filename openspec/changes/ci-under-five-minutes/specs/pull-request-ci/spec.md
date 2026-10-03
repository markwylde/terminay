## MODIFIED Requirements

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

### Requirement: Balanced E2E shards

The E2E suite SHALL be sharded by test rather than by file, so that each of the eighteen shards receives a near-equal number of tests and no shard receives none. A spec whose tests share one application instance created in a `beforeAll` hook SHALL declare itself one group, so its tests stay in one shard and run in declaration order.

#### Scenario: No empty shard

- **WHEN** the suite is listed for each of the eighteen shards
- **THEN** every shard lists at least one test, and the largest shard has no more than the smallest shard plus the size of the largest single group

#### Scenario: Shared-instance spec stays together

- **WHEN** the suite is sharded
- **THEN** all tests of a spec that declares itself one group are listed in the same shard

## ADDED Requirements

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
