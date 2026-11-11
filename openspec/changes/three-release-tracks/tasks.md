## 1. Versions

- [ ] 1.1 Replace `scripts/main-beta-version.mjs` with `scripts/prerelease-version.mjs --track <nightly|canary> --notes-out <file>`, producing `<next>-main.<commit count>.<track>`, and port its tests. Verified by unit tests covering: both tracks, no commits since the last tag, a later commit on the other track sorting higher, nightly above canary on one commit, stable above its prereleases, and any `-beta.N` sorting below.
- [ ] 1.2 Make the version script fail when its commit count is below the count in its track's published `build.json`. Verified by a unit test with a higher published count.
- [ ] 1.3 Update `scripts/sync-package-version.mjs`, `scripts/verify-update-metadata.mjs`, `scripts/build-windows-update-probe.sh` and `scripts/probe-windows-update.mjs` for the new version form; the Windows probe's next version increments the commit count. Verified by their existing test files passing with new-form fixtures.

## 2. Build workflows

- [ ] 2.1 Turn `.github/workflows/main-prerelease.yml` into a reusable workflow taking `track`, which selects the rolling release, asset names, metadata channel, manifest channel and notarization per design decision 2. Rename `scripts/build-main-beta-desktop.sh` to take the track and pass `-c.publish.channel=<track>`. Verified by `scripts/release-config.test.mjs`, `scripts/desktop-update-release.test.mjs` and `scripts/release-artifact-build-contract.test.mjs` asserting both tracks' names.
- [ ] 2.2 Add `.github/workflows/canary.yml`: push to `main` plus the dry-run dispatch, concurrency group `canary` without cancellation. Verified by a workflow contract test asserting the trigger, the concurrency group, and `track: canary`.
- [ ] 2.3 Canary macOS build: pass no notarization credentials, set `-c.mac.notarize=false`, keep the certificate import and the missing-certificate failure, and verify with `codesign --verify --deep --strict`, the `TeamIdentifier` check and a hardened-runtime check in place of `spctl` and `stapler`. Verified by a workflow contract test asserting the canary job references no `APPLE_APP_SPECIFIC_PASSWORD`, and by a dry-run dispatch whose macOS job passes.
- [ ] 2.4 Add `.github/workflows/nightly.yml`: schedule `0 2 * * *` plus dispatch, a first job that compares `main-latest/build.json` with the head commit and skips the build when equal, and `track: nightly` with notarization. Verified by a workflow contract test, and by a unit test of the skip decision for equal, different, and missing `build.json`.
- [ ] 2.5 Publish `build.json` (`commit`, `version`) on each rolling release, moved after the update metadata, and include it in the expected asset set. Verified by the workflow contract test's asset list for both releases.
- [ ] 2.6 Create `canary-latest` when absent, as a prerelease titled for canary, with notes that link no payload. Verified by the contract test and by the first canary run.
- [ ] 2.7 Build server archives per track (`main` names and channel for nightly, `canary` for canary) and verify them with the existing checksum and signature steps. Verified by the archive manifest test asserting `channel: canary` for a canary build.

## 3. Beta to Nightly transition

- [ ] 3.1 In the nightly publication, also publish `beta-mac.yml`, `beta-linux.yml` and `beta.yml` as copies of the nightly metadata, verified by `verify-update-metadata.mjs` and moved in the same swap, guarded by an end-date constant set to the merge date plus 90 days. Verified by the workflow contract test and a unit test of the date guard on both sides of the date.
- [ ] 3.2 Tag the nightly image `beta` as well as `nightly` under the same date guard. Verified by `scripts/ghcr-image.test.mjs` and `scripts/docker-hub-build-args.test.mjs`.
- [ ] 3.3 Map a stored `updateChannel` of `beta` to `nightly` in settings normalisation. Verified by a unit test in the terminal settings tests.
- [ ] 3.4 Prove an installed beta moves: an updater test where a `beta`-channel updater at `6.3.0-beta.812` reads a `beta*.yml` naming `6.3.0-main.3300.nightly` and offers it. Verified by that test in `scripts/app-updater.test.mjs`.
- [ ] 3.5 Record the end date and the `retire-beta-feed` follow-up in `docs/operations/docker-image-release.md`. Verified by the documentation test suite.

## 4. Desktop updater and settings

- [ ] 4.1 Change `AppUpdateChannel` and `TerminalSettings.updateChannel` to `'stable' | 'nightly' | 'canary'`; unknown values read as `stable`. Verified by `tsc` and the settings unit tests.
- [ ] 4.2 Parameterise `electron/appUpdater.ts` by prerelease source: feed URL, metadata name, release page and notes for nightly (`main-latest`) and canary (`canary-latest`); each prerelease channel probes itself and stable only. Verified by `scripts/app-updater.test.mjs` covering every scenario in the two modified update requirements, including nightly to canary, canary to nightly, and canary not reading nightly.
- [ ] 4.3 Update the settings select, its description and keywords, `describeManualCheck`, and `AppUpdateDialog`'s title to name the three channels. Verified by the settings and dialog unit tests, and an Electron e2e through `npm run test:e2e` that selects each channel and sees a check start.
- [ ] 4.4 Point the test feed override in `electron/main.ts` at a prerelease channel that still exists. Verified by the Windows update probe and the updater e2e passing.

## 5. Install commands

- [ ] 5.1 Update `src/shared/serverInstallCommands.ts`: classify `-main.N.nightly` and `-main.N.canary`, emit the image at the client's version, `daemon install main` for nightly and `daemon install canary` for canary, and treat `-beta.N` as unknown. Verified by `src/shared/serverInstallCommands.test.ts` covering the four scenarios of the modified requirement.

## 6. CLI and server

- [ ] 6.1 Add the `canary` reference and channel to `apps/terminay-cli` (`resolve.ts`, `plan.ts`, `layout.ts`, `args.ts` help), resolving `canary-latest` and `terminay-server-canary-linux-<arch>.tar.gz`. Verified by `apps/terminay-cli/test/resolve.test.mjs`, `install.test.mjs` and `commands.test.mjs` covering install, upgrade with nothing newer, upgrade to a newer revision, and `upgrade main` leaving canary.
- [ ] 6.2 Accept `X.Y.Z-main.N.(nightly|canary)` image tags in `apps/terminay-cli/src/imageReference.ts`. Verified by its tests.
- [ ] 6.3 Make the standalone server's release check follow `canary-latest` for a canary install and never offer nightly or tagged releases to it. Verified by the server upgrade unit tests for both scenarios of the added requirement.
- [ ] 6.4 Accept `canary` as a manifest channel in the archive builder and `artifact-manifest.json` verification. Verified by the manifest verification tests.

## 7. Image workflow

- [ ] 7.1 Update `.github/workflows/server-image.yml`: accept the new version grammar, derive the mode from the track, publish `<version>`, `sha-<commit>` and the track's moving tag, and never move another track's tag. Verified by `scripts/ghcr-image.test.mjs` and `scripts/docker-hub-build-args.test.mjs` for release, nightly and canary.

## 8. Rollout checks

- [ ] 8.1 Run a canary dry-run dispatch and a nightly dispatch on a branch and read both runs to completion. Verified by both runs succeeding, with the macOS canary job showing no notarization step and the nightly job showing a stapled app.
- [ ] 8.2 On a clean Apple Silicon Mac and a clean Intel Mac: install notarized stable, switch to Canary, and confirm the un-notarized update installs and launches with no Gatekeeper prompt; then switch Canary to Nightly to Stable and confirm settings survive. Verified by a dated note with macOS versions and results in `openspec/adr/evidence/`.
- [ ] 8.3 After the first real nightly, confirm an installed beta build updates to it and shows Nightly in Settings > Updates. Verified by the same evidence note.
- [ ] 8.4 Confirm no canary payload is linked from the README, the docs, or the `canary-latest` notes. Verified by a documentation test that fails on a `canary-latest/terminay-desktop` link.

## 9. Specs, docs and delivery

- [ ] 9.1 Confirm `pairing-install-instructions-and-beta-image`, `official-container-image` and `remote-server-in-app-upgrade` are archived before this change is, since they own requirements modified here. Verified by `openspec list` and the requirement headers existing in `openspec/specs/`.
- [ ] 9.2 Update `docs/operations/docker-image-release.md` and the release runbooks for the three tracks. Verified by the documentation test suite.
- [ ] 9.3 Run `openspec validate --all`, `npm run smoke`, the CLI and server workspace tests, and `npm run test:e2e`. Verified by their output.
- [ ] 9.4 Open the pull request on `origin` and read back every Gitea commit status as `success` or `skipped`. Verified by the status listing.
