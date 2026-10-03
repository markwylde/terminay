## Why

A pull request waits seven to twelve minutes for CI, and `main` waits as long after every merge. Nothing in the run needs that long: the time goes to work done in sequence that could be done at once, and to work repeated on every job. Measured on runs 17051, 17060, 17065 and 17068:

- **Build, lint, and unit tests: 212–276s.** The gate (about 80s) and every workspace's own suite (about 100s) run one after the other in one job.
- **Container image smoke: 291–367s.** Its four cases run in sequence, about 160s, because the isolated cases publish the same host ports. The image build waits for the host-side install to finish first.
- **Packaged macOS startup smoke: 239–365s.** The session-holder test passes in about 10s and then holds the job for another 29s on a deadline timer nobody cancels.
- **Every Node job: 6–27s at the end.** `actions/setup-node` archives and uploads a 273 MB npm cache each time. The cache server returns the key lower-cased, so the action never sees an exact hit and saves again.
- **E2E: 60–200s of tests per shard** behind an image build of up to 105s.

## What Changes

- Run the unit gate and the workspace suites as two jobs. Between them they run exactly what `npm run test:ci` runs.
- Run the container image smoke cases together, each in its own process with its own host ports. Build the image while the host-side dependencies install.
- Keep npm's download cache in the runner tool cache, which outlives jobs. Stop archiving it through `actions/setup-node`.
- Cancel the session-holder test's deadline timer once the application has quit.
- Shard the E2E suite eighteen ways instead of ten, and deal tests to the shards in turn. Contiguous slices put the slow spec files in a few shards, which then carried three times the test time of the others.
- Build the server UI bundle, the Desktop bundle and the root type check at the same time in `npm run build:app`. Five jobs run that build, and the E2E image build that every shard waits for is one of them.
- Draw the container smoke's published host ports at random. Runners share a container host, so fixed ports fail when two runs overlap.
- State the five-minute budget as a requirement, with the one case that is allowed to exceed it: a run that changes dependencies and so has to build and distribute a new base image.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `pull-request-ci`: the suite is sharded eighteen ways; a full run has a five-minute budget; independent work runs in separate jobs; npm's download cache stays on the runner.

## Impact

- `.gitea/workflows/ci.yml`: a new `workspace-tests` job, eighteen shards, the smoke job's combined build step, and the npm cache location.
- `scripts/container-image-smoke.mjs`: randomly drawn ports, and one process per case.
- `package.json` `build:app` and a new `scripts/run-together.mjs`. The build produces the same outputs; local builds get faster too.
- `scripts/packaged-session-holder-macos.test.mjs`: the cancelled deadline.
- Contract tests that read the workflow: `scripts/provider-portable-ci.test.mjs`, `scripts/e2e-container-contract.test.mjs`, `scripts/repository-ownership-release.test.mjs`.
- `openspec/adr`: a new ADR supersedes ADR-0032, which fixes the shard count at ten and the unit gate at one job.
- No product, protocol or security-boundary changes. The GitHub mirror's workflows are unchanged. `npm run test:ci` still runs everything locally.
