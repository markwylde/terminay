## MODIFIED Requirements

### Requirement: Balanced E2E shards

The E2E suite SHALL be sharded by test rather than by file, so that each of the fourteen shards receives a near-equal number of tests and no shard receives none. A spec whose tests share one application instance created in a `beforeAll` hook SHALL declare itself one group, so its tests stay in one shard and run in declaration order.

#### Scenario: No empty shard

- **WHEN** the suite is listed for each of the fourteen shards
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
