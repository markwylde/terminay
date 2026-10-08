## Context

`CanonicalProjectPathResolver.resolve()` opens every call with `root()`, which
realpaths and stats the configured project root. `FileCatalog.list()` calls
`resolve()` once per entry, and `describe()` called it twice per entry — once
directly, and once through `isSymlink()` → `lexicalPath()` → `root()`. A listing
of a 33-entry project root therefore canonicalized the root around a hundred
times, and `realpath` is a full ancestor walk in the kernel: one call touches
`/Users`, the home directory, and every directory down to the root.

That is why a 20-second idle `fs_usage` capture shows an identical count (393)
on every ancestor directory. The work is invisible in Terminay's own CPU
numbers — the main process reads ~2% — but on a managed Mac each of those
lookups is authorised through the kernel's Endpoint Security subsystem, so
Microsoft Defender's `wdavdaemon_unprivileged` carries the cost and the user
cannot exclude the process.

The same shape appears in the Desktop host: `readTerminalSettings()` does an
`existsSync` plus `readFileSync` for `terminal-settings.json` and another
`readFileSync` for `remote-access-settings.json`, on nearly every host
interaction.

**Boundary this crosses:** ADR-0011 records the server filesystem/Git services →
project root boundary, where "canonical paths and opaque ids are revalidated at
mutation time; traversal, symlink escape, dirty/main deletion, and stale
revisions fail closed". Any reduction in path resolution has to keep that
revalidation intact — this is the constraint the design is built around, not an
afterthought.

## Goals / Non-Goals

**Goals:**

- Make the cost of one directory listing proportional to its entry count, not to
  a multiple of it.
- Keep every containment, traversal, and symlink-escape check exactly as strong
  as it is today, including detection of a project root replaced underneath a
  live session.
- Stop re-reading device-local settings files on each access without ever
  serving a value the host cannot know to be current.

**Non-Goals:**

- Changing *how often* the client asks for a listing. The refresh cadence in
  `useFileExplorerController` — two listings per watch event, plus the git status
  subscription — is a separate concern and is left alone here.
- The periodic `workspace.v4.json` rewrite reported alongside this. It is written
  per applied workspace command, not on a timer, and a no-op guard belongs in
  `WorkspaceStore.apply` where revision semantics live.
- Any protocol, persistence, or client-visible change.

## Decisions

### Thread a per-operation canonical root, rather than caching one

`CanonicalProjectPathOptions` gains an optional `canonicalRoot`. `list()` calls
`resolver.root()` once and passes the result to the directory resolve and to
every `describe()` beneath it; `resolve()` uses a supplied root in place of
calling `root()` itself, and still containment-checks each resolved path against
it.

The first implementation cached the canonical root on the resolver across calls
instead. That is what the issue report asks for ("workspace/git root resolved
once per project and cached"), and it is wrong:
`packages/server-core/test/file-adapter.test.mjs` replaces a project's canonical
root between two operations and requires the second to fail closed. A resolver
that remembers the root answers from a stale value and the replacement goes
undetected — a direct breach of the ADR-0011 revalidation rule. A TTL would only
narrow the window, not close it.

Per-operation scoping keeps the revalidation exactly where the boundary needs it
(each new operation canonicalizes again) and removes the repetition only within
a single operation, which is where all of the amplification lives. The
`canonicalRoot` option is documented as accepting only a value returned by
`root()`; it is an internal server-side API with no protocol surface, and a
caller that could forge it already holds the resolver.

**Alternative considered:** a `withScope(fn)` helper memoizing the root for the
duration of a callback. Rejected because a resolver instance serves concurrent
requests, so the memo would leak between overlapping operations — a fuzzy window
instead of an explicit one.

### Trust the link flag the directory read already returned

`describe()` treated `raw.isSymbolicLink !== true` as "unknown" and probed with
its own `lstat`, which also dragged a `root()` call behind it through
`lexicalPath()`. `readdir({ withFileTypes: true })` already answers this. The
field is optional on `FileDirectoryEntry`, so the flag is trusted only when it
is an actual boolean; a storage adapter that omits it still gets the probe. The
escaped-symlink path is unchanged — a symlink is still canonicalized and still
reported as inaccessible rather than traversed.

### Reuse the stat canonicalization already took

`canonicalTarget()` stats the canonical path deliberately, to close the gap
where a host's `realpath` returns a stale path. `resolve()` then stat'ed it
again, and `describe()` a third time. `canonicalTarget()` now returns the stat it
took and `resolve()` uses it. The check is unchanged; only the repetition is
gone.

### Cache desktop settings behind a watch, and cache nothing without one

`readTerminalSettings()` serves a cached parsed value. An `fs.watch` on the
user-data directory invalidates it on any event naming either settings file, and
the Desktop writers invalidate it inline so a read immediately after a write
never races the watcher callback. If the watch cannot be established, or errors
later, the watcher is dropped and nothing is cached — the host falls back to
reading on every access rather than serving a value whose freshness it cannot
vouch for.

The cached object is now shared between callers where each call previously
returned a fresh object. No call site mutates the returned settings; all of them
spread into a new object before writing.

## Risks / Trade-offs

- **A supplied `canonicalRoot` bypasses root re-verification within its
  operation** → That is the intended scope. Containment is still checked against
  the supplied root for every path, and the next operation re-canonicalizes. The
  contract is stated as a requirement with a root-replacement scenario, and
  `file-adapter.test.mjs` already exercises it.
- **A storage adapter reporting `isSymbolicLink` incorrectly would now be
  believed** → It would have been believed anyway when the flag was `true`. The
  in-tree adapter derives it from `Dirent.isSymbolicLink()`. The catalog test
  suite covers both escaped and internal symlinks.
- **Cached settings could go stale if `fs.watch` silently stops delivering
  events without erroring** → The watcher's `error` handler drops the cache, and
  Desktop's own writes invalidate inline, so the exposure is limited to external
  edits on a platform where the watch is broken but silent. Accepted: the
  fallback when we *know* there is no watch is a full read.
- **The shared settings object could be mutated by a future call site** → No
  current call site does. A regression here would be a correctness bug in the
  mutating code; the repo's lint and type gates do not enforce immutability.
- **The reported ~1.7 s idle cadence is not addressed** → Deliberately out of
  scope, and stated as such. This change reduces the cost of each listing by
  about 3×; the cadence itself needs an `fs_usage` capture of the `open`/`readdir`
  lines to identify its trigger.

## Migration Plan

None. No stored data, protocol field, or user-facing setting changes. The change
is a pure behaviour-preserving reduction in filesystem calls and can be reverted
by reverting the commit.

## Open Questions

- None that block this change. No in-force ADR needs revisiting: ADR-0011's
  revalidation rule is preserved rather than amended, which is why the caching
  approach was rejected.
