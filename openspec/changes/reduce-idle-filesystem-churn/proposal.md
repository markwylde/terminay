## Why

On a managed Mac, leaving Terminay open with one project and three idle
terminals pins Microsoft Defender's `wdavdaemon_unprivileged` at high CPU for as
long as the app is running, and Defender's own per-process statistics rank
Terminay first on the machine. The user cannot exclude the process (tamper
protection), so their only workaround is to quit Terminay. The in-app
Performance panel shows the main process at ~2% CPU, so nothing in the product
surfaces the cost — it is externalised to the endpoint-security agent, which
authorises every filesystem event through the kernel's Endpoint Security
subsystem. Even without an AV agent this is needless wakeups and battery drain
on a laptop that is doing nothing.

A 20-second idle `fs_usage` capture of the main process recorded ~10,500
filesystem events, with every ancestor directory from `/Users` down to the
project root touched an identical 393 times. That equality is the signature of
one path-resolution chain repeated, not of separate scans: the server catalog
re-canonicalizes the project root once per directory entry, and each
canonicalization is a full ancestor walk in the kernel.

## What Changes

- The server file catalog canonicalizes the project root **once per listing
  operation** and threads it through the entries, instead of resolving it again
  for every entry it describes. A root replaced between two operations is still
  caught, because the next operation canonicalizes it again.
- Entry description trusts the symlink flag the directory read already returned
  instead of taking its own `lstat` per entry — and, with it, the root
  resolution that sat behind that call.
- Path resolution reuses the `stat` that canonicalization has just taken rather
  than repeating it.
- The Desktop main process caches the parsed terminal and remote-access settings
  and invalidates that cache from a directory watch and from its own writers,
  instead of re-reading both files from disk on nearly every host interaction.
  With no live watcher, nothing is cached.

Measured on a 40-entry listing, path lookups fall from 121 `realpath` / 201
`stat` / 40 `lstat` to 41 / 81 / 0.

No user-visible behaviour changes: the same listings, the same metadata, the
same settings values, the same containment rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-explorer-and-folder-tabs`: the bounded catalog requirement gains a
  per-operation bound on path canonicalization — a listing canonicalizes the
  project root once and re-verifies it on the next operation, and an entry whose
  directory read already reported link-ness is not re-`lstat`ed.
- `settings-shortcuts-and-desktop-integration`: desktop-local settings files are
  read through a cache invalidated by change notification, not re-read per
  access, and the cache is bypassed entirely when no watch is active.

## Impact

- `packages/server-core/src/fileService/pathResolver.ts` —
  `CanonicalProjectPathOptions` gains an optional `canonicalRoot` that one
  operation passes to the many `resolve` calls it makes; `canonicalTarget`
  returns the stat it took.
- `packages/server-core/src/fileService/catalog.ts` — `list` resolves the root
  once and passes it to `describe`; `describe` trusts the dirent link flag.
- `electron/main.ts` — `readTerminalSettings` reads through a cache armed by an
  `fs.watch` on the user-data directory; the settings writers invalidate it.
- No protocol, persistence, or client changes. The containment and
  root-replacement checks that `packages/server-core/test/file-adapter.test.mjs`
  covers must keep passing; a first attempt that cached the canonical root
  across operations was caught by that suite.
