## 1. Source selection

- [x] 1.1 In `electron/appUpdater.ts`, extract the metadata fetch and `version:` parse from `checkForNotice` into a helper that returns a valid version or throws, parameterised by source (`beta` | `stable`). Verified by the existing notice-only tests in `scripts/app-updater.test.mjs` passing unchanged.
- [x] 1.2 Add `selectSource()`: on Stable return `stable` without probing; on Beta probe both sources in parallel and return the higher by `compareVersions`, preferring `beta` on a tie or a failed stable probe, `stable` on a failed beta probe, and throwing when both fail. Verified by new tests: stable newer (5.8.0 vs 5.8.0-beta.15), beta newer (5.9.0-beta.3 vs 5.8.0), stable probe fails, beta probe fails, both fail, and that the Stable channel performs no beta probe.

## 2. In-place builds

- [x] 2.1 Make `configureFeed` take the source: `stable` uses the Stable channel's existing `github` configuration, `beta` the existing `generic` one; `allowDowngrade` stays `false` for both. Verified by a test asserting the feed options electron-updater receives on Beta when stable wins and when beta wins.
- [x] 2.2 `checkInPlace` calls `selectSource()` first. When both probes fail it still runs the updater check against the beta feed so electron-updater reports the failure through the existing error path. Verified by a test that a Beta install on 5.8.0-beta.14 ends `ready` with 5.8.0 after the harness updater emits `update-downloaded`, and by the existing "a failed check shows nothing and retries later" test passing.

## 3. Notice-only builds

- [x] 3.1 `checkForNotice` uses `selectSource()`'s winning version. Verified by a test that a notice-only Beta build reports `hasUpdate` with `latestVersion: '5.8.0'` and downloads nothing, and one that it reports nothing when both sources are at or below the running version.

## 4. Notes and release link

- [x] 4.1 Remember the source alongside the offered version; reset it wherever `latestVersion` is reset, including `setChannel`. Branch `loadNotes` and `releasePageUrl` on that source instead of `channel`. Verified by tests: a stable version offered on Beta has `releaseUrl` ending `/releases/tag/v5.8.0` and notes from the stable release list; a beta version offered on Beta keeps `/releases/tag/main-latest` and metadata notes; `status().channel` is still `beta` in both.
- [x] 4.2 Confirm the Stable channel is unchanged. Verified by every pre-existing test in `scripts/app-updater.test.mjs` passing without edits to its assertions.

## 5. Validation

- [x] 5.1 `node --test --experimental-strip-types scripts/app-updater.test.mjs`, `npx tsc --noEmit -p .`, and `npx biome lint .` pass.
- [x] 5.2 `openspec validate --all` passes.
- [ ] 5.3 Gitea PR CI statuses all `success` or `skipped`, read back from the head commit.
