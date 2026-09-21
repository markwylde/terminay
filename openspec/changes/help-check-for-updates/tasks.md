## 1. Host

- [x] 1.1 Add a `manual` option to `AppUpdater.check` in `electron/appUpdater.ts` that bypasses the pacing but still joins an in-flight check. Verified by `scripts/app-updater.test.mjs`: "a manual check reaches the network inside the hourly pacing".
- [x] 1.2 Add `describeManualCheck(status)` to `electron/appUpdater.ts`. Verified by `scripts/app-updater.test.mjs`: "a manual check reports what it found" (up to date, downloading, ready, available, failed).
- [x] 1.3 Add **Check for Updates…** as the first Help item in `electron/main.ts`, single-flight, showing the result in `dialog.showMessageBox`. Verified by `npx tsc --noEmit -p .` and `npx biome lint`.

## 2. Title-bar refresh

- [x] 2.1 Add the payload-free `updater.status.changed` event to `packages/protocol/src/host.ts`. Verified by `npm test --workspace packages/protocol`.
- [x] 2.2 Broadcast it from `electron/main.ts` when a manual check settles; subscribe in `src/host/nativeEvents.ts` and re-read status in the `src/App.tsx` poll effect. Verified by `npx tsc --noEmit -p .`.

## 3. Validation

- [x] 3.1 `openspec validate --all` passes.
- [ ] 3.2 Gitea PR CI statuses all `success` or `skipped`.
