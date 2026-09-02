# ADR-0010: Scope pull-request CI to a merge-confidence gate, sharded and provider-portable

Status: accepted
Date: 2026-08-06

## Context

Pull-request CI answers one question: is this change safe to merge? It is not a
release pipeline. Reproducing release packaging, native architecture
qualification, image publication, or deployment evidence on every commit makes
the merge gate slow and fragile without improving merge confidence.

Terminay runs CI on two providers — GitHub and a self-hosted Gitea — whose
artifact services are not interchangeable: Gitea's does not support
artifact-action v4. Gitea gives its own `.gitea/workflows/` directory precedence
and otherwise falls back to `.github/workflows/`, so a shared directory would let
one provider resolve the other's incompatible actions.

The Electron E2E suite is also sensitive to mutable runner packages (GTK,
Chromium, Xvfb), so running it directly on a hosted runner image makes results
depend on whatever that image currently contains.

## Decision

Pull-request CI is a confidence gate consisting of a packaged macOS smoke job,
one fast gate, one shared E2E-image build, and ten Electron Playwright shards:

1. One `ubuntu-latest` job installs dependencies, lints, builds the application,
   and runs the fast non-E2E test suites.
2. One `ubuntu-latest` job builds the complete Docker E2E image once and hands it
   to the shards as a compressed workflow artifact.
3. Ten `ubuntu-latest` jobs split the Electron Playwright suite with
   `--shard=N/10`.

The fast gate is independent. Gitea pull-request CI is the merge gate. It runs
the packaged macOS smoke on the `xcode-16` Lume runner (darwin arm64): it
packages an unsigned `.app`, wraps that bundle in a read-only DMG, copies it with
`ditto` onto a writable directory, then boots the copy — the same launch path as
the notarized release installer, minus Apple signing. Lume workers have no
console GUI session for SSH jobs, so the smoke re-enters `gui/$UID` when that
domain exists and otherwise starts Chromium with `--headless`, `--disable-gpu`,
and `--use-mock-keychain`. Aqua is detected from `launchctl managername` for the
current process, not from whether the GUI domain exists. Unsigned
electron-builder apps fail `codesign --verify --deep --strict`, so pull-request
smoke must not use that check; Developer ID verification stays on the release DMG.
GitHub still runs the same smoke on `macos-latest` for `main` pushes.

GitHub-only workflows live in `.github/workflows/`; Gitea-only workflows live in
`.gitea/workflows/`. Both directories must exist and remain provider-exclusive.
Each provider's ten E2E shards depend only on that provider's E2E-image build,
then run in parallel.

### E2E isolation

Every E2E shard runs through `npm run test:e2e`. Local runs build the repository
Docker E2E image. In CI, the image-build job creates one
`terminay-e2e:ci-$GITHUB_SHA` Linux amd64 image, saves it as a gzip-compressed
workflow artifact, and each shard downloads and loads that exact archive before
running, then verifies the loaded image ID against the builder output. CI
therefore requires amd64 Linux runners for the image job and every shard; local
runs retain host-platform inference. Because no shared provider label expresses
that requirement, both CI jobs fail closed unless `uname -m` reports `x86_64` or
`amd64`.

Each shard writes Playwright output to a distinct shard directory and uploads it
with a unique artifact name, even when the test step fails. The transfer image
expires after one day; diagnostic shard reports expire after seven days. GitHub's
E2E workflow contains only pinned artifact-action v4. The separate self-hosted
Gitea E2E workflow contains only the pinned v3 action pair. Directory-based
provider selection ensures GitHub never resolves the incompatible v3 actions and
Gitea never resolves artifact-action v4.

### Work kept out of pull requests

- Native arm64 qualification belongs to the manually triggered release workflow.
- The pull-request fast gate runs the same local `test:release-evidence` contract
  as the release smoke job: pack-manifest inspection, hosted deployment order,
  supply-chain and production-dependency audits, and related release-config
  checks. Signing, notarization, native archive reproduction, and publication
  stay on the release workflow.
- The E2E workflow artifact is a CI test fixture, not a released server or web
  image. Its commit-derived local tag exists only to fan out one verified test
  environment to the ten shards.
- Server and web image publication does not run for pull requests or ordinary
  main pushes. The manual release publishes the web image directly from its exact
  version tag; the standalone web-image workflow is recovery-only.
- Optional real-provider Codex and Claude probes do not serialize or multiply the
  normal pull-request suite.

## Consequences

- Electron E2E results are independent of mutable runner packages, and no
  registry credentials or package publication are needed for GitHub, Gitea, or
  fork pull requests.
- Two workflow directories must be maintained in parallel and kept
  provider-exclusive; a workflow placed in the wrong directory silently changes
  which actions a provider resolves.
- CI cancels an older run for the same pull-request ref when a replacement commit
  arrives.
- Available Gitea runners execute the E2E-image build plus the independent fast
  gates, then all ten shards once the image is available. The only intentional
  sequencing is the shared-image handoff; adding runners reduces the wait for the
  ten-shard fan-out.
- The ten-shard suite must be balanced from observed durations. If one shard
  consistently exceeds the target, rebalance the shard count or test grouping
  rather than adding another serial gate.
- Defects that only appear under signing, notarization, native arm64, or
  publication are by design not caught before merge; they are caught on the
  release workflow.
