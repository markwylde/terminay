## Context

Pull-request and `main` CI is one Gitea workflow, `.gitea/workflows/ci.yml`. ADR-0032 fixes its shape: a packaged macOS smoke, one fast gate, one E2E image build, and ten Playwright shards that pull the image by tag. Around those sit a packaged Linux lifecycle job, a real-WebRTC job, a container image smoke and an MCP CLI compatibility job.

The fleet is twenty Linux runners (`gitea-runner-pop-os-0..14`, `gitea-runner-home3-0..4`), one job each, and one macOS runner. A run's wall clock is the slowest chain of jobs, so the budget is spent per job, not in total.

Per-job timings, read from the Gitea API and the job logs of runs 17051, 17060, 17065 and 17068:

| Job | Seconds | Where it goes |
| --- | --- | --- |
| Container image smoke | 291–367 | install 25, image build 120, four cases in sequence 160, cache upload 6 |
| Packaged macOS startup smoke | 239–365 | VM start 16–21, install 20–35, build and package 90–110, tests 75 of which 29 is a pending timer, teardown 34 |
| Build, lint, and unit tests | 212–276 | install 22, gate 80, workspace suites 99, release evidence 30, cache upload 8 |
| Real WebRTC pairing | 205–248 | tests 150, cache upload up to 27 |
| Build E2E image | 3–238 | 3 when the tree is already published, about 105 for a source change, 238 when the base is rebuilt |
| E2E shard | 64–500 | pull 10 with the base present and 140–290 without it, tests 57–198 |
| Packaged Linux built-in lifecycle | 123–159 | |
| Real MCP CLI compatibility | 22–41 | |

## Goals / Non-Goals

**Goals:**

- A source-only run finishes in under five minutes on a free fleet.
- Every check that runs today still runs, on every pull request and on `main`.
- `npm run test:ci` and `npm run test:e2e` keep working locally, unchanged.

**Non-Goals:**

- Making a dependency change fast. A new base image is over a gigabyte and every runner pulls it once.
- Changing what any test asserts, or its retry and timeout policy.
- Adding runners. The design fits the twenty there are.
- Removing queueing between overlapping runs. There is one macOS runner; a second run that starts while the first holds it waits for it.

## Decisions

**Split the unit job in two rather than raise turbo's concurrency.** The gate and the workspace suites share only build outputs that turbo restores from the remote cache, so a second job costs one more install (about 22s) and halves the chain. Raising `--concurrency` inside one job was the alternative; the suites were set to run one at a time on purpose, and several of them start servers. The workflow runs the same npm scripts `test:ci` names, and a contract test compares the two, so the jobs cannot drift from the local command.

**Run the smoke cases as processes, not as promises.** The script drives the container engine with synchronous calls, so cases in one process cannot overlap without rewriting every helper. With no `--only`, the script now starts itself once per case and prints each case's output whole when it ends. The control case still runs every time: the workflow passes no `--only`, and a contract test holds it to that.

**Draw published ports at random.** Runners share a container host. With fixed ports, run 17077's smoke job failed with `port is already allocated` because another pull request's smoke job held 28443. Each isolated case draws a signaling port and an ICE range below the kernel's ephemeral range, and draws again when the engine reports them taken. That also keeps the cases apart from each other.

**Build the application's independent parts together.** `build:app` ran the server UI bundle, the root type check and the Desktop bundle in sequence; they write to `dist-web`, nowhere, and `dist` with `dist-electron`. `scripts/run-together.mjs` runs them at once, holds each one's output until it ends, and stops the others on the first failure. The preload bundle and the bundle manifest stay in sequence after the Desktop bundle, which they depend on. A second build path for CI only was the alternative; one path means the E2E image, the packaged smokes and a developer's machine all build the same way.

**Build the image beside the install.** The official image build and the host-side `npm ci` share nothing. One step starts the build in the background, installs and builds the two packages the device bundle imports, then waits for the build and fails with its log if it failed.

**Keep npm's cache in the runner tool cache.** The runner mounts a persistent volume at `runner.tool_cache`. Pointing `npm_config_cache` there makes the cache a property of the runner: nothing to restore, nothing to save. `actions/setup-node`'s `cache: npm` was the previous mechanism and stays correct on a provider whose cache server returns keys verbatim; on this one it uploaded the archive after every job. npm checks each cached tarball against the lockfile's integrity hash, so a shared cache cannot change what is installed. The cache boundary crossed is the runner's own disk, already shared by every job on that runner through the Docker store.

**Eighteen shards.** A shard's length is its slowest part of the run: at fourteen shards run 17094 had 27 tests and up to 139 seconds of them in a shard, behind a 111 second image build. When the image is ready, five other Linux jobs are still running and fifteen runners are free; three of those jobs end within twenty seconds, which frees the rest. Eighteen shards therefore start within about twenty seconds of each other and carry a quarter fewer tests each. More shards than that would wait for the two long jobs.

**Deal tests to shards in turn.** Playwright's `--shard` cuts the ordered test list into contiguous slices, and the slow tests sit together in a few spec files. At eighteen shards run 17096 had shards of 21 tests carrying anywhere from about 40 to 156 seconds of them, and the longest shard is what the run waits for. The container's runner now lists the suite, deals each test to the shard holding the fewest so far, and passes that shard's tests to Playwright with `--test-list`. Every shard computes the same deal from the same image, so the lists are disjoint and complete; the runner checks that under Playwright's own matching rules and falls back to `--shard` if the check fails. A spec with a `beforeAll` hook or a declared group is dealt whole, so its setup runs once. Weighting the deal by recorded durations would balance better still, but needs a timings file that someone has to keep current; dealing in turn needs nothing.

**Key the base image on what an install reads.** The base key hashed every byte of `package.json`, so adding a test file to the `smoke` script published a new base and sent every runner a gigabyte to pull: run 17087 spent 228 seconds in the image job and over two minutes of each shard that way, for a one-line script edit. The key now reads a manifest without the scripts npm does not run during an install. The base's installed dependencies are the same either way, and the per-commit image copies the real manifest over the base's.

**Keep the layered registry images of ADR-0032.** Building the application inside every shard instead of once was considered: it removes the image job from the chain, but puts eighteen TypeScript and Vite builds on hosts that each carry several runners. One build, one push and a ten-second pull is cheaper.

## Risks / Trade-offs

- [The tool cache is not persistent on some runner] → `npm ci` falls back to the registry and the job is slower, not wrong. The first run on each runner is cold in any case.
- [The npm cache grows without a prune] → It grows by one tarball per new package version. It is a few hundred megabytes today, against images of several gigabytes that the existing cleanup already manages.
- [Four smoke cases at once contend for CPU] → Each case keeps its own 90s readiness and 120s device deadlines, which are several times what a case takes alone.
- [Eighteen shards plus six other jobs fill the fleet] → A second run that overlaps the first queues. That was already true with seventeen jobs.
- [A dependency change exceeds the budget] → Stated in the spec as the exempt case.

## Migration Plan

One pull request. The shard count appears in the workflow, three contract tests and the spec; they change together. Reverting the pull request restores the previous shape with no data to migrate. Per-commit E2E images already in the registry stay valid: their key does not depend on the shard count.

## Open Questions

- ADR-0032 fixes ten shards and one fast gate. This design changes both, so the ADR step records a superseding ADR.
