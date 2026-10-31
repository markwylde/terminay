## Context

Terminay keeps its state in about 33 files, written from 26 modules in `electron/`, `packages/server-core`, `packages/ui-bundle` and `apps/terminay-server`. The full inventory was taken from the code on 2026-10-31.

How they are written today:

- **Durable already:** only the recording metadata helpers (`electron/recording/service.ts` and `recordingService/storage.ts`) do a full durable replace: temp, fsync, rename, fsync of the directory.
- **Partly durable:** `desktopInstanceIdentity.ts`, `diagnostics/core.ts` and `deviceCredentialStore.ts` fsync the file but not the directory.
- **Rename with no flush:** every other writer renames without flushing. Eight of them use a fixed `<file>.tmp` name, so two writers can collide.
- **In place:** three files are written directly: `terminal-settings.json`, `remote-access-settings.json` and `git-trace.key`.

How they are read today:

- **Startup stops** on an unparseable desktop instance id, workspace, server settings, macros, automations, safe-storage vault, extension registry, remote device list or host key. Only the workspace reaches a recovery screen, and it offers only Retry.
- **Silent reset** to defaults for `terminal-settings.json` and `remote-access-settings.json`, which loses user data without a word.
- **Accepted as valid:** a zero-filled `git-trace.key`. Only its length is checked, so a key of zeros is used as a secret.
- **Copied runtime:** the Windows holder runtime copy (`sessionHolderRuntime.ts`) is trusted whenever its `.complete` marker exists. Its copied files are never flushed, so a zero-filled `pty.node` is used forever.

A Windows VM that lost power showed six of these failures at once (proposal). The specs already require durable, recoverable canonical state ("Canonical state durability", "Corrupt state preservation"). ADR-0002's SQLite repository, which would cover part of this, is not what Desktop runs today.

In-force ADRs that constrain this change:

- **ADR-0002 (SQLite repository):** not adopted here. This change hardens the file backends that are in use.
- **ADR-0003 (vault envelopes):** not rollback-resistant on their own, which rules out `.previous` for secret stores.
- **ADR-0035 / ADR-0083:** the detached holder and its runtime copy.
- **ADR-0086:** Windows pipe credentials. The holder credential is a credential store.

## Goals / Non-Goals

**Goals:**
- Every Terminay-owned state file is replaced durably on Windows, macOS and Linux.
- Every reader treats an unreadable or invalid file as corrupt. It never uses it, never deletes it, and handles it by its kind (ADR-0088).
- A bad shutdown never leaves Desktop unable to start without the user being offered a way forward.
- The Windows holder runtime copy is verified before use.

**Non-Goals:**
- Moving state into SQLite (ADR-0002).
- Durability of user documents edited in the file viewer, recordings (already durable), diagnostic event streams, and caches outside the data root.
- Protecting against disk failure or deliberate tampering beyond the existing envelope checks.
- `apps/terminay-cli` and the standalone server's lease and upgrader files. They use the same pattern but are not Desktop startup state. They are listed as a follow-up.

## Decisions

### One helper, two entry points, in `server-core`

`packages/server-core/src/durableFile.ts` exports the following:

- `writeFileDurably(path, data, { mode, keepPrevious })` and a sync twin.
  1. Open a uniquely named temp file in the same directory with `wx` and the requested mode.
  2. Write the data.
  3. Flush it with Node's `fsync`. On darwin, libuv already issues `fcntl(F_FULLFSYNC)` and falls back to `fsync`, so this needs no native binding. A unit test pins that assumption to the Node version in use.
  4. When `keepPrevious` is set, refresh `<path>.previous` from the current target before the rename.
  5. Rename over the target.
  6. On POSIX, flush the directory. Windows has no directory flush, and the NTFS journal orders the rename after the flushed data.
- `readStateFile(path, { kind, parse, validate })` returns `{ status: 'ok', value }`, `{ status: 'missing' }`, `{ status: 'restored', value }` or `{ status: 'corrupt', preservedAs }`. Corrupt means unreadable bytes, a failed parse, a failed validate, or a file whose bytes are all zero.
  - Before returning `restored` or `corrupt`, it renames the bad file to `<path>.corrupt-<timestamp>`.
  - `kind` is `canonical`, `secret` or `rebuildable`. Only `canonical` looks at `.previous`.
- `electron/` imports the helper from the built `server-core` package, as it already does for other server-core code. Desktop gets no second copy of the logic.

*Alternative:* add fsync at each call site. Rejected because it is 26 places to get right, and the inventory shows they have already drifted.

### `.previous` is refreshed by copy, flushed, then the target is replaced

For canonical files, step 4 copies the current target to a temp file, flushes it, and renames it to `<path>.previous`. Only then is the new target renamed in. A hard link would be cheaper, but on Windows a hard link cannot be renamed over while the target is open elsewhere, and copies are kilobytes. If the current target is itself corrupt when a save happens, which can only follow a fallback load, it is not copied. `.previous` keeps the last good content.

*Alternative:* a numbered history of N copies. Rejected because one good copy covers an interrupted save, and more is a backup feature, which the operations runbook already covers.

### Recovery by kind, decided where each store is loaded

Each store's loader calls `readStateFile` with its kind and maps the four results:

| Kind | Files | `restored` | `corrupt` |
|---|---|---|---|
| canonical | workspace, desktop instance id, server settings, terminal settings, remote-access settings, macros, automations and runs, MCP connected servers, connection profiles, window composition, extension registry (the user's install and enable choices) | load it and queue a one-time "earlier save restored" notice | stop with a typed `state_unreadable` error naming the store, which the host turns into the choice below |
| secret / credential / revocation | safe-storage vault, headless vault, provider vaults, device credentials, remote devices list, host key, push enrolments, MCP capability digests, git-trace key | never happens (no `.previous`) | start empty and fail closed, with a notice naming what must be set up again |
| rebuildable | holder records, close records, tails, app-window records, window-server cache, ui-bundle pointer, worktree insights, diagnostics preferences and launch record | never happens | treat as missing and carry on, recording a diagnostics event |

App-window records move from "skip and delete" to "skip and preserve". The `terminal-app-windows` scenario "A damaged record" is unchanged: the window is discarded and startup continues.

The desktop instance id is canonical, not a credential. It names the data root, and a new id would orphan the workspace. Its `.previous` fallback is therefore safe and preferred.

The git-trace key is a secret, but it is derived. A corrupt key, including all zeros, is regenerated, and existing traces become unreadable. That is acceptable for a diagnostics trace.

### The host asks; the server never chooses fresh state

The server never starts a canonical store empty on its own. A `state_unreadable` error carries a store name from a closed set, never a path. Desktop's existing host-owned recovery document (`connections-and-client-hosts` "Startup failure recovery") gains a **Start fresh** button next to **Retry**.

- **Start fresh** calls a privileged main-process action. The action re-runs the store's load with `acceptFresh: true`: the corrupt file has already been preserved, and the store then commits its empty or default state.
- **Retry** re-runs the load unchanged.

The action lives in `electron/` and is reached only from the host-owned recovery document, never from the server bundle. A remote client cannot reset a Desktop's state. On a standalone server there is no such document, so the server logs the store name and exits non-zero, and the operations runbook gains a "start fresh" step.

The restored-save notice uses the existing notification surface, sent once after the first workspace snapshot.

### The holder runtime copy carries a manifest

`prepareHolderRuntime` does the following:

1. Copy the runtime as now.
2. Walk the copy and write `manifest.json`, listing each relative path with its size and SHA-256.
3. Flush every file, and each directory where possible.
4. Write `.complete` last, with a durable write.

On reuse, it reads the manifest and checks every file's size and digest. Hashing runs in the main process at server start, before the first holder spawn, over about 200 MB. On failure, or with no manifest, the copy is renamed to `<key>.corrupt-<ts>` and made again. `pruneHolderRuntimes` also removes `*.corrupt-*` copies once no holder runs from them.

*Alternative:* check sizes only. Rejected because the incident's files had the right sizes and were all zeros. *Alternative:* sample a few blocks. Rejected because a partial flush can zero any page.

### Hot paths

The workspace repository already coalesces commits through its transaction queue. Device terminal settings are written on user action. Holder tails are written once per ended session. No writer saves per keystroke, so per-save flushes need no new batching. The one write in the PTY path, holder records on spawn, is per holder, not per byte.

## Risks / Trade-offs

- [A flush on a slow or network disk takes tens of milliseconds and blocks a sync writer] → Sync writers are startup or shutdown paths and holder records. Everything on the event loop uses the async variant.
- [`F_FULLFSYNC` is slow on macOS (it flushes the drive cache)] → It is used only for state files, not recordings or streams, at most a few times per user action.
- [Start fresh discards state the user might have recovered by hand] → The corrupt file is preserved beside the target, the document says so, and Retry stays available.
- [A corrupt credential store forces re-pairing every remote device] → This is intentional (ADR-0088). The notice says which devices are affected.
- [Hashing the runtime adds start-up time on Windows] → One pass over about 200 MB on each server start. It is measured in the VM as part of the tasks, with a budget of 1 s.
- [Changing readers that used to reset silently to defaults now stop startup] → Only for canonical stores, and only when `.previous` is also bad. That is the behaviour the spec already requires ("never silently replaced with defaults"), and it now comes with a way forward.

## Migration Plan

Existing installs have no `.previous` and no runtime manifest. The first save of each canonical file creates its `.previous`. A runtime copy without a manifest counts as unverified and is copied again once. Rollback to an older release ignores `.previous`, `*.corrupt-*` and `manifest.json`, so it is safe.

## Open Questions

None. Recovery choices were settled with the owner: fall back to `.previous` with a notice, ask the user when there is no good copy, fail closed for credentials, rebuild derived state silently.
