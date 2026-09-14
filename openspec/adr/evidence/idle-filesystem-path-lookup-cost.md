# Idle filesystem path-lookup cost

Terminay was reported as the top trigger of Microsoft Defender for Endpoint
activity on a managed Apple Silicon Mac: `wdavdaemon_unprivileged` sat at high
CPU for as long as the app was open, while Terminay's own main process measured
~2% CPU. Defender's `mdatp diagnostic real-time-protection-statistics` ranked
the Terminay main process first on the machine, ahead of every other
application, and tamper protection prevented the user from excluding it.

## Field capture

A 20-second `sudo fs_usage -w -f filesys -t 20 <main-pid>` sample of an
otherwise idle window — one project, three terminals, no commands running —
recorded roughly 10,500 filesystem events, about 500/s.

| Syscall | Count |
| --- | --- |
| `fcntl` | 2574 |
| `getattrlist` | 2479 |
| `close` | 1768 |
| `read` | 1281 |
| `ioctl` | 861 |
| `stat64` | 669 |
| `pathconf` | 393 |
| `write` | 259 |
| `lstat64` | 118 |
| `open` | 44 |

| Path | Count |
| --- | --- |
| `<project-root>` | 858 |
| `~` | 397 |
| `~/Documents/projects` | 393 |
| `~/Documents` | 393 |
| `/Users` | 393 |
| `<project-root>`'s parent | 388 |
| each top-level entry of `<project-root>` | 12 |

The identical count on every ancestor directory from `/Users` down is the
signature of one path-resolution chain repeated, not of separate scans:
`realpath` walks the whole chain on each call. With about 33 top-level entries
and 12 listings in the window, 33 × 12 = 396 accounts for the 393 observed on
each ancestor.

## Reproduced in isolation

`FileCatalog.list()` over an in-memory storage adapter with 40 entries, counting
adapter calls. The adapter is the same interface the desktop wiring implements,
so each `realpath` here corresponds to one full ancestor walk in the kernel.

| | `realpath` | `stat` | `lstat` | total |
| --- | --- | --- | --- | --- |
| Before | 121 | 201 | 40 | 362 |
| After | 41 | 81 | 0 | 122 |

Before, each entry cost three root canonicalizations and one link probe:
`describe()` resolved the entry directly and again through
`isSymlink()` → `lexicalPath()` → `root()`, and `resolve()` opened with `root()`
every time. After, the root is canonicalized once for the listing, the link flag
comes from the directory read, and `resolve()` reuses the stat canonicalization
already took.

`packages/server-core/test/file-catalog-path-budget.test.mjs` asserts this
budget so it cannot regress silently.

## What this evidence does not cover

The ~1.7 s cadence at which the listing repeats while the window is idle was not
identified. The repeat driver is in the client refresh path — the Explorer
controller issues two listings per watch event and separately refreshes Git
status from a subscription that its own queries can feed — and settling it needs
an `fs_usage` capture filtered to `open` and directory-read lines rather than the
`getattrlist` volume that dominates the sample above.
