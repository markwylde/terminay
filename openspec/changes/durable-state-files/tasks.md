## 1. Durable file helper

- [x] 1.1 Add `packages/server-core/src/durableFile.ts` with `writeFileDurably` (async and sync): unique `wx` temp in the same directory, fsync, optional `.previous` refresh (copy, fsync, rename), rename, POSIX directory fsync. Export it from the package. Verified by a new `packages/server-core/test/durable-file.test.mjs` that checks the contents and mode, that no temp file is left behind after success or a thrown write, that `.previous` holds the prior content, and that two concurrent writers never collide.
- [x] 1.2 Add `readStateFile` and a registry of every state file it reads (path, kind) used by the regression suite in group 7 with kinds `canonical`, `secret` and `rebuildable`, returning `ok`, `missing`, `restored` or `corrupt`. Treat all-zero bytes, a failed parse and a failed validation as corrupt, and rename the bad file to `<name>.corrupt-<ts>`. Verified by unit tests covering each result for each kind: zero-filled file, truncated JSON, a valid file with an invalid shape, a corrupt file with a good `.previous`, a corrupt file with a corrupt `.previous`, and a secret store whose `.previous` is never read.
- [x] 1.3 Fold the recording helpers (`electron/recording/service.ts`, `recordingService/storage.ts`), `desktopInstanceIdentity.ts`, `diagnostics/core.ts` `atomicWritePrivateJson` and `deviceCredentialStore.ts` `write` onto the helper. Verified by their existing tests passing unchanged.

## 2. Canonical stores

- [x] 2.1 Workspace: give `FileWorkspaceStateBackend` (`workspaceRepository.ts`) durable writes with `keepPrevious`, and a load through `readStateFile`. `restored` loads the copy and queues the notice. `corrupt` raises `state_unreadable` with store `workspace`. Verified by repository tests for a zero-filled workspace with and without a good `.previous`.
- [x] 2.2 Desktop settings in `electron/main.ts`: `server-settings.v1.json`, `terminal-settings.json` (no longer written directly), `remote-access-settings.json` (no longer written directly and no longer reset silently), `server-macros.v1.json`, `connection-profiles.json`, `window-composition.v1.json`, `mcp-connected-servers.v1.json`. Verified by a new `scripts/durable-desktop-state.test.mjs` that drives each loader with a zero-filled file, asserts restore-or-`state_unreadable`, and asserts that none of them returns defaults on its own.
- [x] 2.3 Desktop instance id: durable write with `.previous`, and a corrupt-aware read that restores from `.previous`. Verified by an added test in the instance-identity suite.
- [x] 2.4 Automations, automation runs and the MCP connected servers backend (`automationService/fileBackend.ts` `writeAtomically`), and the extension registry (`extensions/installer.ts`): durable writes with `.previous`, plus a corrupt-aware load. Verified by their suites with a zero-filled file added.

## 3. Secret, credential and revocation stores

- [x] 3.1 Safe-storage vault, headless vault and provider vaults: durable writes with no `.previous`. A corrupt envelope is preserved, and the vault opens empty and locked out of old secrets, with a `secret_store_reset` notice. Verified by vault tests: a zero-filled envelope never throws at startup, and no older envelope is ever read.
- [x] 3.2 Device credentials, `remote-devices.v1.json`, the host key (`apps/terminay-server/src/remote/hostedHostKey.ts`), push enrolments, MCP capability digests: durable writes with unique temp names. A corrupt store fails closed: no device is admitted and every device must pair again. Verified by tests that a zero-filled device list admits nobody and does not stop startup.
- [x] 3.3 `git-trace.key`: durable write. An all-zero or wrong-length key is treated as corrupt and regenerated. Verified by a `worktreeCapture` test that a zero-filled 32-byte key is replaced.

## 4. Rebuildable state

- [x] 4.1 Session-holder records, close records and tails (`sessionHolder/holder.ts`, `closeRecord.ts`, `tails.ts`): durable writes with unique temp names. Corrupt files are preserved and skipped, and startup continues. Verified by session-holder tests with a zero-filled record, plus the Desktop bootstrap no longer failing on one (`scripts/durable-desktop-state.test.mjs`).
- [x] 4.2 App-window records, the window-server cache, the ui-bundle pointer and assets, worktree insights, diagnostics preferences and the launch record: durable writes, and corrupt files are preserved and skipped rather than deleted. Verified by each suite with a zero-filled file.

## 5. Holder runtime manifest

- [x] 5.1 `prepareHolderRuntime` writes `manifest.json` (path, size and SHA-256), flushes the copied files and directories, and writes `.complete` last. On reuse it verifies the manifest, and a failed or missing manifest means the copy is moved aside and made again. `pruneHolderRuntimes` removes unused `*.corrupt-*` copies. Verified by `scripts/session-holder-runtime.test.mjs` cases: an intact copy is reused without copying, a zero-filled `pty.node` causes a recopy, and a copy with no manifest is recopied once.
- [ ] 5.2 Measure verification time in the Windows VM on a release build. Verified by a diagnostics event with its duration: under 1 s.

## 6. Host recovery and notices

- [x] 6.1 Map `state_unreadable` to the recovery document. Name the store in plain words, add **Start fresh** beside **Retry**, and back it with a privileged main-process action that reloads the store with `acceptFresh`. Retry changes nothing on disk. Verified by an E2E test (`npm run test:e2e`): a zero-filled workspace and `.previous` show the document, Retry keeps both files, and Start fresh opens an empty workspace with both files preserved.
- [x] 6.2 Show the one-time "earlier save restored" notice and the credential-reset notice through the notification surface. Verified by an E2E test with a zero-filled workspace and a good `.previous`: the workspace opens and the notice shows once.
- [x] 6.3 Standalone server: `state_unreadable` logs the store and exits non-zero. Add a "start fresh" step to `docs/operations/`. Verified by a server-core test and the runbook diff.

## 7. Corrupted-data-root regression suite

- [x] 7.1 Add `e2e/corrupt-state.spec.ts`, run through `npm run test:e2e`. It launches Desktop, opens two terminals, changes a setting and pairs a test device, then quits. It then rewrites every state file in the data root as zeros at its original length, the way this incident left them: the workspace, all settings, macros, automations, vaults, credentials, holder records and tails, the extension registry, the ui-bundle pointer, and the instance id. On relaunch, Desktop must either open (restoring `.previous` where it exists) or show the recovery document with Start fresh. It must never be stuck on Retry alone, never crash, and never show defaults without saying so. Verified by the test passing.
- [x] 7.2 In the same spec, a parameterised case for each state file alone, for three corruption shapes: zero-filled, truncated to half, and replaced with invalid JSON. Each case asserts the outcome its kind requires (restored with a notice, choice offered, failed closed with a notice, or rebuilt silently), and that the corrupt file is preserved as `*.corrupt-*`. The list of files comes from the helper's store registry, so a store added later without a corrupt-file case fails the suite. Verified by the test passing and by a deliberately unregistered store making it fail.
- [x] 7.3 Add a unit test that runs `writeFileDurably` against a recording fake `fs` and asserts the order: write temp, fsync temp, (copy, fsync and rename `.previous`), rename, fsync directory on POSIX. Deleting any flush fails the test. Verified by the test passing and failing with the fsync removed.
- [ ] 7.4 Windows: the same zero-filled data root, plus a zero-filled holder runtime copy, in the Windows probe workflow (`terminay-windows-tests`) against a packaged build. The packaged app must start and open a working PowerShell terminal. Verified by the probe run's result.

## 8. Verification

- [x] 8.1 `npm run build`, `npm run lint`, the smoke unit tests and `npm run test:e2e`. Verified by their output.
- [ ] 8.2 In the Windows VM: hard-reset the VM straight after changing settings and opening terminals, then relaunch. Terminay must start, or show the recovery choice, and never be stuck on Retry. Verified by screenshots.
- [ ] 8.3 Open the PR on Gitea and read back the combined commit status as `success`. Verified by `/status` `.state` and `.total_count`.
