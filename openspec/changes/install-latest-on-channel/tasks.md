## 1. Desktop updater

- [x] 1.1 Add `channelLatest: { version, source, order } | null` to `AppUpdateStatus`, filled from every `selectSource` result. Null for a development build, where in-place update is unavailable, and before the first check. Verified by `scripts/app-updater.test.mjs` cases: Stable ahead, Nightly with stable higher, and development build.
- [x] 1.2 Add `installLatest(expectedVersion)` to `AppUpdater`. It waits for any in-flight check, resolves the source, and refuses when the resolved version equals the running one or differs from `expectedVersion`. Otherwise it configures the feed with `allowDowngrade = true` for that one check, and requests restart-to-update on `update-downloaded`. `configureFeed` keeps resetting `allowDowngrade = false`. Verified by unit cases: downgrade path calls `quitAndInstall`, mismatch is refused, equal is refused, and the next ordinary check runs with `allowDowngrade` false.
- [x] 1.3 Expose `updater.install-latest` as a capability-gated host action carrying only a version string, handled in `electron/main.ts`, with `installLatestAppUpdate` in `src/host/nativeActions.ts`. Verified by `packages/protocol/test/host.test.mjs` rejecting a missing, non-string, URL-shaped or extra-field action, and by the reviewed-actions list in `scripts/task20-desktop-security-audit.test.mjs`.

## 2. Desktop Updates page

- [x] 2.1 In `updatesPageModel.ts`, compute the install-latest row: label, target version, `downgrade` flag, enabled state, and disabled reason (already latest, development build, update in progress). Verified by `updatesPageModel` unit tests for each state.
- [ ] 2.2 Render the row under VERSIONS on This Mac → Updates, with a confirmation dialog that shows the downgrade warning when `downgrade` is set, plus download progress and the failure message. Verified by render tests in `scripts/settings-updates-ui.test.mjs` (row, both versions, warning only for an older build, disabled reason), and by an e2e case in `e2e/settings-update-channel.spec.ts`, run via `npm run test:e2e`: the development build the suite runs shows the row disabled with its reason, and the host refuses an `updater.install-latest` request. An e2e build cannot update itself in place, so the download-and-restart path is covered by the `scripts/app-updater.test.mjs` cases of 1.2.

## 3. CLI and helper

- [x] 3.1 `daemon upgrade --check` reports `latest` with `order`. Below a container image's release, it reports install-latest as unavailable, with the reason. Verified by `apps/terminay-cli/test/check.test.mjs` cases for newer, same, older, source install, and below the container floor.
- [x] 3.2 Write the `terminay-upgrade-latest` path and oneshot units for system scope, with the fixed `daemon upgrade --system --allow-downgrade` command and a separate request file. `daemon upgrade` adds any that are missing, and `daemon uninstall` removes them. Verified by `apps/terminay-cli/test/systemd.test.mjs` asserting each pair's unit text and fixed command, modes, the invocations that arm and remove both pairs, and by `check.test.mjs` for an install whose helper predates the pair.

## 4. Server

- [x] 4.1 Accept optional `latest` in `parseUpgradeCheckOutput` and publish it, its order, and its install-latest availability in the `server.upgrade` status. A system-scope server whose install lacks the new units reports the host command. Verified by `apps/terminay-server/test/release-upgrader.test.mjs` and `packages/protocol/test/server-upgrade.test.mjs`.
- [x] 4.2 Accept `allowOlder` on the upgrade request, still rejecting any other field. Map it to `--allow-downgrade` in `upgradeArguments`, or to the install-latest request file on system scope. Reject it when `latest` is the same, absent, or unavailable, and reject an older target without it. Verified by `packages/server-core/test/server-upgrade-protocol.test.mjs` and `server-upgrade-service.test.mjs` cases for each rule.

## 5. Server Updates UI

- [x] 5.1 In `packages/client-core` and `serverUpgradeModel.ts`, derive the install-latest action, and send `allowOlder` only for an older target. Verified by `packages/client-core/test/server-upgrade.test.mjs` and `src/workspace/serverUpgradeModel.test.ts`.
- [x] 5.2 Add the action to `SettingsServerUpdates.tsx`, with the reason and copyable command when unavailable, and pass `downgrade` to `ServerUpgradeDialog`. No action on Local. Verified by `scripts/settings-updates-ui.test.mjs` (ahead, same, blocked with command, in progress, upgrader without `latest`, Local) and `scripts/server-upgrade-ui.test.mjs`.

## 6. Finish

- [x] 6.1 `openspec validate --all` passes, and the change is ordered after `three-release-tracks`, `remote-server-in-app-upgrade` and `settings-server-rail` for archive. Verified by the validate output and `openspec list`.
- [ ] 6.2 Unit suites (bounded `node --test --test-force-exit --test-timeout=120000`), lint, typecheck, and `npm run test:e2e` pass. Verified by their output.
- [ ] 6.3 Open a pull request on `origin` with `tea`, and read back every Gitea commit status as `success` or `skipped`. Verified by the status listing.
