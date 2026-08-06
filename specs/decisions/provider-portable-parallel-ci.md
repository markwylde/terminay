# Pull-request confidence gate

Pull-request CI answers one question: is this change safe to merge? It is not a
release pipeline and must not reproduce release packaging, native architecture,
image publication, or deployment evidence on every commit.

## Required jobs

Each pull request creates exactly six independent jobs:

1. One `ubuntu-latest` job installs dependencies, lints, builds the application,
   and runs the fast non-E2E test suites.
2. Five `ubuntu-latest` jobs split the Electron Playwright suite with
   `--shard=N/5`.

No pull-request job depends on another job. The scheduler can dispatch all six
immediately, subject only to available runner capacity.

## E2E isolation

Every E2E shard runs through `npm run test:e2e`. That command builds and uses the
repository's pinned Docker E2E image, so Electron does not depend on GTK,
Chromium, Xvfb, or other mutable packages from the runner image. Each failed
shard reports its exact Playwright failure in the job log without relying on a
provider-specific artifact service.

## Work kept out of pull requests

- Native arm64 qualification belongs to the manually triggered release
  workflow.
- Standalone artifact reproduction, release evidence, signing, auditing, and
  publication belong to the release workflow.
- Server and web image workflows do not run for pull requests or ordinary main
  pushes. They run only when the manual release creates a version tag.
- Optional real-provider Codex and Claude probes do not serialize or multiply
  the normal pull-request suite.

## Operational expectations

- CI cancels an older run for the same pull-request ref when a replacement
  commit arrives.
- Five Gitea runners can execute five of the six jobs at once; adding a sixth
  runner permits literal all-at-once execution. There is no artificial workflow
  sequencing.
- The five-shard suite should be balanced from observed durations. If one shard
  consistently exceeds the target, rebalance the shard count or test grouping
  instead of adding another serial gate.
