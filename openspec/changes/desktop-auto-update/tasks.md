## 1. Packaging

- [x] 1.1 Add `electron-updater` as a runtime dependency and pass the
  supply-chain audit. Verified by `npm run test:release-evidence`.
- [x] 1.2 Add a `publish` block (`github`, `markwylde/terminay`) and a mac `zip`
  target to `electron-builder.json5`; `build:mac` builds `dmg zip`. Verified by
  `scripts/release-config.test.mjs` / `release-artifact-build-contract.test.mjs`
  asserting the targets and that `--publish never` is kept.

## 2. Main-process updater

- [x] 2.1 Create `electron/appUpdater.ts`: channel-aware feed (GitHub provider
  for stable, generic `main-latest` for beta), `canInstallInPlace` detection,
  background download, status state machine, fallback to notify-and-link on
  error. Verified by `scripts/app-updater.test.mjs` driving it with a fake
  `autoUpdater` through each state and both install capabilities.
- [x] 2.2 Fetch stable release notes from the GitHub REST releases list,
  filtered to `installed < v <= available`, newest first, capped, cached per
  version; beta notes from the update info. Verified by unit tests with a fake
  `fetch` covering several-behind, prerelease exclusion, and failure.
- [x] 2.3 Replace `fetchAppUpdateStatus` in `electron/main.ts` with the module;
  wire `updater.install` to the restart flag and route the graceful quit's
  final `quit` through `quitAndInstall(false, true)` when set. Verified by the
  `restart to update installs and relaunches only at the final quit` case in
  `scripts/app-updater.test.mjs` (`finishQuit` is the graceful handler's final
  quit) and `updater.install` added to the desktop security audit's reviewed
  action list.
- [x] 2.4 Reconfigure the channel from `device.settings.update`. Verified by the
  updater unit test asserting `setChannel` triggers an immediate check.

## 3. Protocol and settings

- [x] 3.1 Add `updater.install` to `packages/protocol/src/host.ts`, parsed with
  exact keys and gated on `updater`. Verified by `packages/protocol/test`.
- [x] 3.2 Add the `updateChannel` device setting (`stable` default, `beta`),
  with normalization and settings-UI metadata (an **Updates** category).
  Verified by the settings case in `scripts/app-updater.test.mjs` asserting the
  default, normalization, and that it survives `selectDeviceTerminalSettings`.

## 4. Renderer

- [x] 4.1 Extend `AppUpdateStatus`/`parseUpdateStatus` and add
  `installAppUpdate()` in `src/host/nativeActions.ts`; new fields are optional
  so an older host's status still parses. Verified by typecheck.
- [x] 4.2 Title-bar action: "Restart to update (vX)" when ready, "Update
  available (vX)" link-out when not installable, plus a What's new entry.
  Verified by typecheck and build.
- [x] 4.3 What's new dialog rendering notes with `markdown-it` (`html: false`,
  image rule disabled), links via `openExternalUrl`, and a link-out on notes
  failure. Verified by the sanitizer case in `scripts/app-updater.test.mjs`
  feeding script, event-handler, image, and `javascript:` payloads.

## 5. Release pipelines

- [x] 5.1 `trigger-release.yml`: upload `zip` + blockmaps with sidecars; keep
  the generated `latest-*.yml` as workflow artifacts; attach them in
  `publish-release-notes` after the notes edit. Verified by the release
  contract tests updated to pin this order.
- [x] 5.2 `main-prerelease.yml`: desktop mac/linux beta build job with
  `<next>-beta.<run>` versions, fixed asset names, commit-log release notes;
  add them to the `.incoming`/rename flow with `beta-*.yml` renamed last and to
  the verified asset set. Verified by the release contract tests.

## 6. Verification

- [x] 6.1 `npm run lint`, typecheck, `npm run smoke`, and
  `npm run test:release-evidence` pass locally.
- [ ] 6.2 Gitea PR CI statuses all `success` or `skipped`.
