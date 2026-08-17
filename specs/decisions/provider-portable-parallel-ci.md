# Pull-request confidence gate

Pull-request CI answers one question: is this change safe to merge? It is not a
release pipeline and must not reproduce release packaging, native architecture,
image publication, or deployment evidence on every commit.

## Required jobs

Each pull request creates a packaged macOS smoke job, one fast gate, one shared
E2E-image build, and five Electron Playwright shards:

1. One `ubuntu-latest` job installs dependencies, lints, builds the application,
   and runs the fast non-E2E test suites.
2. One `ubuntu-latest` job builds the complete Docker E2E image once and
   hands it to the shards as a compressed workflow artifact.
3. Five `ubuntu-latest` jobs split the Electron Playwright suite with
   `--shard=N/5`.

The fast gate is independent. GitHub runs the real macOS smoke: it packages
an unsigned `.app`, wraps that bundle in a read-only DMG, copies it with
`ditto` onto a writable directory, then boots the copy. That is the same
launch path as the notarized release installer, minus Apple signing.
Gitea has no macOS runners, so it records an explicit unavailable-runner
fallback on Ubuntu instead of pretending the smoke ran. GitHub-only
workflows live in `.github/workflows/`; Gitea-only workflows live in
`.gitea/workflows/`. Gitea gives its own directory precedence and otherwise
falls back to `.github/workflows/`, so both directories must exist and remain
provider-exclusive. Each provider's five E2E shards depend only on that
provider's E2E-image build, then run in parallel.

## E2E isolation

Every E2E shard runs through `npm run test:e2e`. Local runs build the repository
Docker E2E image as before. In CI, the image-build job creates one
`terminay-e2e:ci-$GITHUB_SHA` Linux amd64 image, saves it as a gzip-compressed
workflow artifact, and each shard downloads and loads that exact archive before
running, then verifies the loaded image ID against the builder output. CI
therefore requires amd64 Linux runners for the image job and every shard; local
runs retain host-platform inference. Because no shared provider label expresses
that requirement, both CI jobs fail closed unless `uname -m` reports `x86_64`
or `amd64`. This keeps Electron
independent of GTK, Chromium, Xvfb, and other mutable runner packages while
avoiding registry credentials and package publication for GitHub/Gitea and fork
pull requests. Each shard writes Playwright output to a distinct shard directory
and uploads it with a unique artifact name, even when the test step fails. The
transfer image expires after one day; diagnostic shard reports expire after
seven days. GitHub's E2E workflow contains only pinned artifact-action v4. The
separate self-hosted Gitea E2E workflow contains only the pinned v3 action
pair, because its artifact service does not support v4. Directory-based
provider selection ensures GitHub never resolves the incompatible v3 actions
and Gitea never resolves artifact-action v4.

## Work kept out of pull requests

- Native arm64 qualification belongs to the manually triggered release
  workflow.
- The pull-request fast gate runs the same local `test:release-evidence`
  contract as the release smoke job: pack-manifest inspection, hosted
  deployment order, supply-chain and production-dependency audits, and
  related release-config checks. Signing, notarization, native archive
  reproduction, and publication stay on the release workflow.
- The E2E workflow artifact is a CI test fixture, not a released server or web
  image. Its commit-derived local tag exists only to fan out one verified test
  environment to the five shards.
- Server and web image publication does not run for pull requests or ordinary
  main pushes. The manual release publishes the web image directly from its
  exact version tag; the standalone web-image workflow is recovery-only.
- Optional real-provider Codex and Claude probes do not serialize or multiply
  the normal pull-request suite.

## Operational expectations

- CI cancels an older run for the same pull-request ref when a replacement
  commit arrives.
- Five Gitea runners can execute the E2E-image build plus the independent fast
  gates, then all five shards once the image is available. The only intentional
  sequencing is the shared-image handoff; adding runners reduces the wait for
  the five-shard fan-out.
- The five-shard suite should be balanced from observed durations. If one shard
  consistently exceeds the target, rebalance the shard count or test grouping
  instead of adding another serial gate.
