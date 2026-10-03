# ADR-0036: CI has a five-minute budget, met by running independent work in separate jobs and fourteen E2E shards

Status: accepted, supersedes ADR-0032
Date: 2026-10-03
Supersedes: ADR-0032

## Context

ADR-0032 kept the pull-request CI shape of ADR-0010 — a packaged macOS smoke,
one fast gate, one E2E image build, ten Playwright shards — and changed how
shards receive the E2E image: a lockfile-keyed dependency base and a thin
per-commit image, both in the internal registry, with the suite sharded by
test. The image decisions hold. With the base on a runner, a shard pulls its
image in about ten seconds.

The shape no longer fits the time a run is allowed. A run took seven to twelve
minutes, on pull requests and on `main`. Job timings from the Gitea API for
runs 17051, 17060, 17065 and 17068 put the time in sequencing, not in the
checks themselves:

- The fast gate ran its own checks and then every workspace suite, 212–276
  seconds in one job.
- The container image smoke ran four cases one after another, about 160 of its
  291–367 seconds.
- Every Node job ended by archiving and uploading a 273 MB npm cache, because
  the cache server returns keys lower-cased and `actions/setup-node` therefore
  never sees an exact hit.
- Ten shards carried 57–198 seconds of tests each, behind an image build of
  about 105 seconds.

ADR-0032 fixes the gate at one job and the shards at ten, so changing either
needs a new record.

## Decision

1. **A full run has a five-minute budget**, from the run's creation to its
   last job's completion, for pull requests and for `main`, when its jobs do
   not wait for a runner and runners hold the current dependency base. A run
   that publishes a new base is exempt.
2. **Work that shares no state runs in separate jobs or processes.** The fast
   gate and the workspace suites are two jobs that between them run exactly
   `npm run test:ci`; a contract test compares them to that script. The
   container image smoke runs every case at once, each in its own process on
   its own host ports, and builds the image while dependencies install.
3. **The E2E suite runs in fourteen shards**, sized to the runners left free
   while the other Linux jobs are still running. The count changes with the
   fleet, not with the suite.
4. **A cache that a runner can keep is kept on the runner.** npm's download
   cache lives in the runner tool cache. No job archives, uploads or downloads
   it.
5. **The rest of ADR-0032 stays in force**, restated here because this record
   replaces it: the confidence-gate scope and provider-exclusive workflow
   directories of ADR-0010; amd64-only E2E jobs that fail closed elsewhere;
   the dependency base image tagged by a hash of exactly its inputs and the
   per-commit image built from it; distribution through the internal registry
   with cleanup that keeps the newest base; build-time caches shipped in the
   per-commit image; and sharding by test, with a spec that shares one
   application instance declaring itself a group.

## Consequences

- A job that grows past about four minutes breaks the budget on its own. The
  remedy is to split it, not to raise the budget.
- A pull request now occupies up to twenty-one runners for part of its run.
  Two overlapping runs queue; the single macOS runner queues first.
- The unit jobs install dependencies twice. That costs about twenty seconds of
  runner time and saves about a hundred of wall clock.
- The first job on a runner with an empty tool cache installs from the
  registry. A runner whose tool cache is not persistent does so every time and
  is slower, never wrong: npm verifies each tarball against the lockfile.
- The smoke script's cases must stay independent. A case that needs a host
  port takes one no other case uses.
- A dependency change still pays for one base build and a full pull on every
  runner, and may exceed the budget once.
