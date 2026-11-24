## Context

The Git service (`packages/server-core/src/gitService/service.ts`) observes each
bound repository with one watch on its common Git directory and one recursive
watch per working tree (ADR-0028; ADR-0114 builds the recursion from one-level
watches on Linux). Watch events mark worktrees dirty and schedule a refresh
through the ramp. A refresh re-measures the dirty worktrees, caches the listing
while the watches are trusted, and publishes `git.status.changed` per worktree.
The renderer updates only on those events, on resubscribe, on directory
changes, and on its own mounts and refreshes.

History that explains how the sidebar got here:

- `b59797fd` (Sep 24) replaced the 10 s poll with watches and cached listings.
  A failed watch made the repository "measured on demand".
- `fdba1d73` (Oct 2) made `'root'` and `'refresh'` listings fresh, after a card
  kept a pre-pull delta for about 11 minutes with no cause found. The mount
  effect in `useFileExplorerController.ts` also sends `'root'`, so from then on
  every mount corrected the sidebar as a side effect.
- `d575dbd8` (Oct 18) moved post-push tests onto fresh listings to fix a flake,
  which hid the push bug.
- `71b6ef43` (Nov 13) added the Linux tree watch, which fails when its root is
  deleted. `observationFailed` then turns the whole repository's observation off
  until it is rebound. That watch also arms its directories asynchronously after
  `watch()` returns, but nothing waits for that. `observationTrusted` only checks
  that `commonDir` is set, so a measurement can be cached before the watches
  that vouch for it cover the tree.

The defects:

1. `publishStatusChange` suppresses an event when its fingerprint
   `{ state, branch, head, entries, bounded }` is unchanged. Card values
   (ahead-of-default count, line counts, unpushed work, prunable) are outside
   it. After a push with no upstream, or a default-branch move, those values
   change and the fingerprint doesn't, so the renderer is never told.
2. Deleting a worktree root fails that tree watch, either in `closeSubtree('')`
   or, when the root is already gone at arm time, as a raw `ENOENT` from the
   root's `fs.watch`. `addWatch`'s `onError` calls `observationFailed`, which
   closes every watch of the repository and sets `unavailable`. Nothing ever
   clears it, so the registry removal that follows is never observed.
3. A listing is trusted before its watches are ready.

## Goals / Non-Goals

**Goals:**

- The sidebar is accurate without remounts: removals, pushes and
  default-branch moves reach the renderer through events.
- The repository stays observed when one of its worktrees is deleted, on Linux,
  macOS and Windows.
- A cached listing is only ever vouched for by watches that cover it.
- A lost observation recovers without polling.
- A renderer connection or mount costs no Git when nothing changed.
- Each repository is measured once after binding, not twice.

**Non-Goals:**

- Measuring only the active project, or a setting for it. Inactive projects
  feed Home's PR and checks chips. A mount answered from the cache already
  removes the cost.
- Sharing one in-flight fresh measurement between concurrent fresh requests.
  Issue #652 listed it as optional. Doing it safely needs rules for project
  identity across projects that share a repository, for per-caller
  cancellation, and for release or rebind while waiting. Once mounts stop being
  fresh, concurrent fresh requests come only from explicit refreshes and root
  changes, which are rare. Each fresh request keeps measuring on its own.
- Stale PR badges. They come from forge extension properties and are not
  traced here.
- Changing the `git.status.changed` payload. It stays metadata-only.
- Changing which projects `App.tsx` mounts.
- Noticing that a deleted worktree's folder has been restored without any Git
  or registry change (Decision 2). The next measurement picks it up.

## Decisions

### 1. Publish when any listed value changes

`measureWorktrees` passes each worktree's summary to `publishStatusChange`. The
publish decision uses a second fingerprint, kept per
`project/repository/worktree` key beside the existing one. It is the summary
reduced by `listedSummaryFingerprint(summary)`, which takes every field of
`GitWorktreeSummary` except an explicit exclusion list for per-measurement
values. That list is empty today: no summary field is a timestamp, duration or
revision. Excluding by name rather than including by name means a field added
later is compared by default. Without that, the same drift that caused this bug
would happen again.

An event is published when either fingerprint changed. The status fingerprint
keeps covering branch status values the summary doesn't carry, such as
upstream ahead and behind. Status-only callers (`status()`) touch only the
status fingerprint. A listing measurement compares and stores both, so
alternating `status()` and listing calls can't make one history publish what
the other already published. Both maps are cleared together.

*Alternatives:* add the five card fields to the existing fingerprint. Rejected,
because it's another hand-picked list. Publish whenever a listing differs at
list level: that loses the per-worktree attribution the renderer uses to scope
refreshes.

### 2. A root that went away is a removal, not a failure

Each watcher reports a vanished root with one error type,
`WatchedRootGoneError`, tested with an exported `isWatchedRootGone(error)`.

- **Linux tree watch.** It raises the error from `closeSubtree('')`, and also
  when arming the root (`rel === ''`) fails with `ENOENT` or `ENOTDIR`.
- **Native watch (macOS/Windows).** It records the root's identity
  (dev/ino/birthtime, as in `5a325bf4`) when it opens. Three things trigger a
  root check:
  - an `error`;
  - an unexpected `close`;
  - a `rename` whose filename is null or names the root itself.

  The check `lstat`s the root. A missing root (`ENOENT`/`ENOTDIR`) or a changed
  identity reports root-gone. An unchanged root turns a `rename` into an
  ordinary change, and turns an `error` or `close` into the original error. A
  failing `lstat` with any other code reports the original error. A check that
  completes after the handle was closed reports nothing. `fs.watch` and `lstat`
  are injectable so every path can be tested without a real platform.

In the service, a `working-tree` watch's `onError` checks `isWatchedRootGone`.
If it is, the service closes that one watch, marks the observation `dirtyAll`,
counts a `registry` change and requests the ramp. The refresh re-lists. The
layout either drops the worktree, or keeps it as prunable with
`hasWorkingTree` false. `syncWorkingTreeWatches` then wants no watch for it.
Every other error, and every Git-directory watch error, still goes through
`observationFailed`.

If the folder is later restored with no registry or Git-directory change,
nothing observes that. The next measurement re-derives the layout and arms the
watch again. That measurement can come from an explicit refresh, a root change,
any Git-directory change, or a request against an unavailable observation.
Watching the parent directory of every linked worktree just for this was
rejected: those parents are often outside the project (siblings of the
repository), and the case is rare.

*Alternatives:* re-list from the Git-directory watch only, and ignore
working-tree errors. Rejected, because a genuine working-tree failure (ENOSPC,
the directory ceiling) must still degrade to on-demand.

### 3. Watches report readiness, and only ready watches vouch for a cache

`GitWatchOptions` gains `onReady()`.

- **Native watch.** Ready as soon as `fs.watch` returns, reported on a
  microtask.
- **Linux tree watch.** Ready when discovery first finishes: no directory is
  still waiting for the filter, its arm or its listing after the root was
  armed. Changed entries still waiting to be classified don't hold readiness
  back, so sustained writes can't delay it; they are delivered as usual.
  Directories armed later (new directories, refilters) don't change readiness.
  Their own "written before armed" delivery already covers them.

The service tracks a `ready` flag per watch. `observationTrusted` additionally
requires every open watch to be ready. Each observation keeps a promise,
`watchesReady`, that settles when every current watch is ready or the
observation becomes unavailable or closed. `syncWorkingTreeWatches` adding a
watch replaces it with a new pending promise.

`listWorktreesFrom` awaits `watchesReady`, together with the caller's abort
signal, before it claims dirty state. After waking it looks up the project's
observation again and waits again if that is a different one that is not
ready: a rebind during the wait must not measure under watches nobody waited
for. The existing check after measuring
(`claim.trusted && observationTrusted(observed)`) then means: cache only if the
watches were ready when the claim was taken and are still ready and live. A
watch that fails after it became ready goes through `observationFailed`, which
already drops the cached listing.

Waiting can't hang. Each pending watch either becomes ready, fails into
`observationFailed`, or is closed, and each of those settles `watchesReady`.
The tree watch's discovery is bounded by its directory ceiling and runs in
bounded async steps (ADR-0114).

*Cost:* the first listing after binding a large repository waits for its tree
watch to arm. Task 6.4 measures that wait on the issue's sample workspace. The
alternative is measuring twice, which is
what happens today, and caching a listing no watch vouches for.

### 4. Re-arm an unavailable observation on the next request

`observationFailed` keeps its behaviour. In `listWorktreesFrom`, a request with
any origin except `watch`, made against an unavailable observation that isn't
closed, starts `rearm(observation)` unless one is running. `rearm`:

1. sets a `rearming` flag that suppresses the unattributed event in
   `observationFailed`;
2. clears `unavailable`, sets `commonDir` to null, and sets `dirtyAll`:
   changes made while nothing watched are unknown, so the first measurement
   under the new watches covers every worktree, even when the request that
   started the attempt was scoped to one. A failed attempt restores `dirtyAll`
   to what it was before;
3. runs `syncWorkingTreeWatches` and `watchGitDirectory`;
4. awaits `watchesReady`.

If any watch fails during the attempt, the observation goes back to
unavailable. The failure is reported as `watch.failed` without another
status-change event. The request that started the attempt waits on
`watchesReady` like any other listing (Decision 3). It is cached only if the
attempt succeeded.

This is ADR-0028's "unobservable means on demand": the attempt happens only
because a caller asked. No timer is introduced.

*Risk:* on a host that is out of inotify capacity, each request repeats the
attempt (a directory walk plus `git check-ignore`). Requests against an
unavailable repository are rare, because no events arrive. The attempt runs in
bounded async steps (ADR-0114), and at most one is in flight per repository.

### 5. A `'mount'` trigger that reads the cache

`GitPaneSyncTrigger` gains `'mount'`, and `isFreshGitPaneSync('mount')` is
false. The trigger choice moves into a pure helper,
`rootLoadTrigger(previousLoadedRoot, root)`. It returns `'root'` only when
`previousLoadedRoot` is non-empty and differs from a non-empty `root`, and
`'mount'` otherwise. The root-load effect keeps `lastLoadedRootRef`. It updates
that ref only when it actually loads a non-empty root, so these cases come out
right:

- **Dependency-only reruns:** the same root, so `'mount'`.
- **Creation becoming ready:** the first load, so `'mount'`.
- **Root becomes empty, then a different root arrives:** the ref still holds the
  first root, so `'root'`.

The listing memory (`f803201b`) still paints first, then the cached listing
replaces it.

This lands last. Before Decisions 1–4 and their tests are in, it would remove
the accidental cleanup and leave the sidebar staler.

### Boundaries crossed

- **Server/renderer boundary:** none changes. The renderer still uses the
  preload or server API, the event payload is unchanged, and the trigger is a
  renderer-local label that only chooses `fresh`.
- **Project boundary:** fingerprints, readiness and re-arm are keyed by
  repository and project exactly as today. One project's request can re-arm a
  repository it shares with another project, and that's correct: they share the
  watches (spec: "Projects that share a repository SHALL share its watches").
  Fresh measurements aren't shared (Non-Goals), so no caller ever receives a
  measurement taken under another project's identity.

## Risks / Trade-offs

- [macOS FSEvents may not report root deletion the way the code expects] →
  Every native notification path is covered by injected-`fs.watch` tests, and
  the real-watch tests run on the macOS CI runner.
- [Windows isn't exercised for real] → CI has no Windows runner. Windows uses
  the same native-watch code as macOS, and its paths are covered only by the
  injected tests. The PR states this explicitly.
- [More events after pushes and pulls] → They're published only when a shown
  value really changed, and the renderer's refresh ramp already bounds the
  listings they raise.
- [The first listing waits for tree-watch readiness] → Bounded by ADR-0114's
  ceiling and step sizes. A repository over the ceiling fails into on-demand
  measurement rather than waiting.
- [Re-arm repeated on a host out of watch capacity] → Bounded, async, at most
  one attempt in flight, and only on client requests (Decision 4).
- [A mount served from a cache that's wrong for some unobserved change] →
  Explicit refresh stays fresh and still reports `cache.mismatch`, so a
  remaining blind spot surfaces in diagnostics instead of being silently
  corrected.

## Migration Plan

No data or protocol migration. The change ships as one PR, ordered by its
tasks:

1. publication;
2. root removal;
3. readiness;
4. re-arm;
5. the `'mount'` trigger, last.

Rolling back is a revert. The renderer change falls back to fresh mounts on
its own if reverted alone.

## Open Questions

None. In-force ADRs 0028 and 0114 are honoured. ADR-0141 refines what counts
as a Git watch failure and how Git observation recovers, without reversing
either.
