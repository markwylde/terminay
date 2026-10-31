## Why

After an unclean shutdown, Terminay can fail to start at all. On Windows, a VM that lost power came back with its saved workspace, three settings files, a session-holder record and the copied terminal runtime all filled with zero bytes. Every launch then stopped on "Terminay could not open this workspace", and Retry could never succeed: the only way out was to find and move the broken files by hand.

The cause is technical. Terminay saves state by writing a temporary file and renaming it over the old one, but it never forces the new bytes to disk first. Some files are written in place with no rename at all. After a crash or power loss, the rename can survive while the data does not. NTFS shows this most often. XFS, and macOS without a full flush, can do the same. The specs already require canonical state to be recoverable after an interrupted write and never silently replaced with defaults. The implementation does not meet either requirement.

## What Changes

- Every write of Terminay's own state goes through one durable-replace helper: write a temporary file, flush it to stable storage (a full flush on macOS), rename it over the target, then flush the directory where the platform supports it. Files that are written in place today are moved onto the helper.
- Each canonical state file keeps its previous good copy. If the current file is unreadable or invalid at startup, Terminay keeps the broken file for diagnosis, loads the previous copy and tells the user it did so.
- If there is no good previous copy, the startup recovery screen asks the user. They can start fresh (the broken file is kept aside and that state starts empty) or leave it as it is and retry. Terminay never makes that choice silently.
- Secret, credential and revocation stores never roll back to an older copy, because that could bring back a revoked device or a rotated secret. When one is unreadable it is kept aside, and the store fails closed (no paired devices, no stored secret) with a notice.
- Rebuildable data is kept aside and rebuilt without asking. This covers session-holder records, the copied holder runtime, and the other caches.
- The copied holder runtime records a manifest of its files. It is verified on launch and copied again when any file fails the check, so a zero-filled native module never runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: "Canonical state durability" requires each replace to reach stable storage before it commits. "Corrupt state preservation" defines the previous-good-copy fallback, the user's choice when there is none, fail-closed credential stores, and rebuilding derived state. A new requirement covers verifying the copied holder runtime.
- `connections-and-client-hosts`: "Startup failure recovery" offers a start-fresh action next to Retry when persisted state is unreadable and has no good copy, and the startup notice reports a fallback.

## Impact

- New shared helper for durable replace and guarded reads, used by `packages/server-core` and `electron/`. The existing fsync code in `recordingService/storage.ts`, `electron/recording/service.ts` and `desktopInstanceIdentity.ts` is folded into it.
- Writers move onto the helper: `workspaceRepository.ts`, settings and macro persistence in `electron/main.ts`, `desktopWindowComposition.ts`, `appWindows/store.ts`, `automationService/fileBackend.ts`, the vaults, `deviceCredentialStore.ts`, `push/enrolments.ts`, session-holder `holder.ts`/`tails.ts`/`closeRecord.ts`, `worktreeInsights/stores.ts`, `extensions/installer.ts` and `ui-bundle/src/store.ts`.
- `electron/sessionHolderRuntime.ts` writes and verifies a file manifest, and flushes the copy before marking it complete.
- The Desktop startup recovery document gains a start-fresh action and a restored-from-backup notice.
- Each save adds one flush, a few milliseconds on most disks. Workspace commits are already batched, and the design covers the hot paths.
