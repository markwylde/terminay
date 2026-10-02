## Context

Since `git-status-watch-and-project-release` the Git service
(`packages/server-core/src/gitService/service.ts`) keeps one
`RepositoryObservation` per bound repository. It watches the common Git
directory and every working tree, attributes each event to a scope
(`ignore`, named worktrees, `all`, `registry`), re-measures only what the
claimed scope names, carries every other worktree's summary forward, and
answers listings from `observation.listing` while the watches are trusted and
nothing is dirty.

On 2026-10-02 the installed beta served a pre-pull delta for a linked worktree
for about eleven minutes. The row corrected when that worktree's own Git
directory was touched. The same merge-then-pull was then run against the built
service four ways — plain pull, project rooted in the linked worktree, a copy
of the affected repository's history, and the service's own `pullWorktree` —
and every run re-measured the row within a second. The cause is unknown.

What made it unknowable:

- `observationFailed(observation, _error)` discards the error and records
  nothing. Whether the watch was alive cannot be told.
- `observedChange`, `claimDirty`, `measureWorktrees`, and `cachedListing` leave
  no trace. Whether the default-branch event arrived, what it invalidated, and
  whether the row was re-measured or carried cannot be told.
- The renderer's resize and root-change refreshes are answered by the same
  cache, so they neither corrected the row nor produced evidence.
- The observation tests inject a fake watcher. Nothing exercises
  `NodeGitStateWatcher` through a ref move end to end.

In-force ADRs that constrain this design: ADR-0028 (no polling without owner
approval), ADR-0021 (background cost is measured in child processes),
ADR-0011 (trust-boundary model), ADR-0017 (every project executes on its
server), ADR-0018 (one workspace bundle, many server connections).

## Goals / Non-Goals

**Goals:**

- The next stale row is explained by the Diagnostics folder alone.
- A user who refreshes gets a measured listing, and a disagreement with the
  cache is recorded as such.
- The real watcher is covered by a test through a default-branch move.

**Non-Goals:**

- Fixing the stale row. The cause is not known; guessing at a fix would hide
  it. Attribution, claim, carry-forward, and ramp logic are unchanged.
- Any timer that runs Git. No verification poll, no periodic re-measure.
- Diagnostics for file-explorer directory watches, agent-discovery watches, or
  settings watches. They are separate services; this change is the Git
  observation path and the pane that renders it.
- Shipping standalone-server reports to Desktop.

## Decisions

### 1. The Git service reports through a typed observer; hosts decide where it goes

`GitServiceOptions` gains `onObservation?: (report: GitObservationReport) => void`.
`GitObservationReport` is a discriminated union defined in
`gitService/types.ts`; the service calls it inside `try/catch` so a throwing
host cannot change a result. `ServerTerminalAuthority` forwards it as
`onGitObservation`, and `electron/main.ts` maps it to
`desktopDiagnostics.record(..., { channel: 'lifecycle' })` with
`component: 'local-server'`, `source: 'local-server-git'`, exactly as
`onFileOperationFailure` is mapped today. `apps/terminay-server/src/cli.ts`
writes one JSON line per report to stderr with the `[terminay-server]` prefix
its other diagnostics use.

Boundary crossed: server-core → server host. server-core stays free of
Electron and of any log sink (ADR-0017); the Desktop diagnostics boundary
("ownership stays in Desktop main") is respected because main, not the
service, writes.

Alternative considered: have the service write JSONL itself. Rejected — it
would give server-core a filesystem log sink and a second retention policy.

### 2. Process-local diagnostic ids, entry classes, and no paths

The diagnostics spec forbids project ids, roots, repository and worktree
paths, and refs as recorded fields, and forbids authority-bearing ids as
correlation keys. Canonical `repo-…`/`worktree-…` ids are path hashes that
authorise requests, so they are not used.

The service keeps a `Map` from canonical id to a counter-assigned diagnostic
id (`r1`, `w3`) for the life of the process. A worktree's first report carries
`role: 'main' | 'linked'` and `listIndex` — its position in
`git worktree list` — which is enough to tell rows apart by running that
command, without the path being recorded.

`observation.ts` gains `classifyGitDirEntry`, a pure function beside
`attributeGitDirChange` that mirrors it branch for branch; a test asserts the
two agree for every entry kind. The classes are: `head`, `index`, `default-branch-ref`, `branch-ref`, `remote-ref`,
`packed-refs`, `config`, `worktree-registry`, `linked-worktree-state`, `lock`,
`inert`, `unnamed` (a null filename), `other`. Working-tree events are the
single class `working-tree`.

A watch failure's `code` and `message` are reported as given; a path inside
that message is retained, as the spec already allows for error text.

Alternative considered: record paths, as extension failures record stacks
verbatim. Rejected — those are errors from trusted code; these would be a
continuous record of which files the user touches.

### 3. One summary per refresh cycle, not one record per event

A checkout produces hundreds of events. Each observation accumulates
`{ byClass, byScope, cachedListingsServed }` counters. A measurement takes
the counters together with its dirty claim, at the moment it starts, and
reports them when it completes; a failed or abandoned measurement hands them
back with the claim. Counting at completion instead would attribute a change
that arrives mid-measurement to the wrong record — a fast-forward's ref move
landing during the index-scoped measurement would read as "default branch
moved, one worktree carried forward", which is exactly the false lead this
change must not produce. When no measurement follows — the events
invalidated nothing, or a listing was answered from cache — a single unref'd
one-shot timer armed by the first counted event or cached answer emits a
`changes` summary after five seconds. It stands down while a measurement is
running or owed, since that measurement's claim takes the counts.

That timer is armed only by an observed event or a served request, runs no
Git, and does not re-arm itself, so it is damped work after something that
already happened, which ADR-0028 permits, not a poll.

Measurement records are already bounded by the 1–20 s ramp. All records use
the lifecycle channel so a renderer console flood cannot hide them, and remain
subject to the 16 KiB per-event and per-source burst bounds.

Alternative considered: record `ignore`d events individually at a debug level.
Rejected — the always-on collector has no debug level, and a lost event is
visible as its absence from the class counts.

### 4. What a measurement record carries

`measurement.completed` carries: repository diagnostic id; `claim`
(`all` | `scoped`), `trusted`; counts `remeasured` and `carried`; for each
re-measured worktree (first 32) its diagnostic id, `ahead`, `additions`,
`deletions`, `changedFiles`; `durationMs`; `cached` (whether the result was
kept as `observation.listing`); `published` and `suppressed` status-change
counts; `raisedBy` (`watch` | `request` | `refresh`); and the accumulated
change summary. `measurement.failed` and `measurement.abandoned` (released or
re-bound mid-measurement) carry the claim and that it was restored.

Numbers against the default branch are recorded because the question a stale
row raises is "which measurement produced this number, and when".

### 5. Explicit refresh and root change bypass the cache and report a mismatch

`git.worktrees.list` accepts an optional boolean `fresh`. The renderer sets it
for the Explorer refresh control and for the project-root-change load; every
other caller omits it. `GitService.worktrees` with `fresh` skips
`cachedListing`, claims everything, measures, and — when the observation was
trusted and clean and a cached listing existed — compares each worktree's
`head`, `state`, `aheadOfDefaultBranchCount`, `lineAdditions`,
`lineDeletions`, and entry count with the cached summary. Any difference emits
`cache.mismatch` naming the differing worktrees and fields. The measurement is
served and becomes the cache.

This is the only behaviour change. It is a user action, not a timer, so it is
outside ADR-0028's concern, and its cost is one full measurement per explicit
refresh (ADR-0021: bounded by user action, zero when idle).

Boundary crossed: client → server protocol. The field is optional, boolean,
and validated by the existing bounded-object check; older servers ignore it
and older clients never send it, so no protocol version change is needed
(ADR-0018).

Resize is deliberately not a `fresh` trigger: it fires continuously while
dragging.

Alternative considered: verify the cache on every listing by comparing ref
tips. Rejected — that is a poll in disguise, and it would mask the defect
this change exists to find.

### 6. Renderer sync outcomes use the console evidence main already observes

The renderer has no logging IPC and must not get one (ADR-0011). Desktop main
already records renderer `console.info` lines on a bounded channel.
`applyGitWorkspaceRefresh` emits one line with a fixed prefix,
`[terminay] git.pane.sync`, followed by a JSON object:
`{ trigger, scoped, outcome, worktrees, durationMs, unchangedSince }`.
`applied-unchanged` outcomes are counted and reported as `unchangedSince` on
the next line rather than logged, so an idle pane is silent. Browser hosts get
the same line in their own console and nothing else.

`refreshGitStatusesForRoot` gains a `trigger` argument so each call site names
itself: `event`, `resync`, `root`, `refresh`, `directory`, and `action` for the
refresh that follows a worktree action such as delete, pull, or sign-in.

### 7. A real-watcher test

`packages/server-core/test/git-real-watch-default-branch-move.test.mjs` builds
a bare remote, a clone with a linked worktree nested under the main checkout,
merges the branch on the remote, pulls in the main checkout, and asserts —
with the default `NodeGitStateWatcher` and no injected fake — that the linked
worktree's delta reaches zero and that the reports show a `default-branch-ref`
change invalidating `all`. A second case uses `pullWorktree`. The test polls
its own assertion with a deadline; it is a test harness wait, not product
polling.

## Risks / Trade-offs

- [The records do not capture the cause next time] → The classes and the
  carried/re-measured split cover every branch in the current code path; the
  `cache.mismatch` record fires on the user's own refresh even if the cause is
  outside that path, and names the row.
- [Record volume on a busy repository] → One measurement record per ramp step
  (at most one per second, widening to one per twenty) plus rare summaries; the
  per-source burst bound caps the worst case and reports the suppression.
- [`fresh` makes the refresh control slower on very large repositories] → It
  runs the same commands a watch-raised full measurement runs, once per click.
- [The real-watcher test is timing-sensitive in CI] → It waits on an outcome
  with a generous deadline rather than on a fixed delay, and runs on the Linux
  and macOS lanes that already run server-core tests.
- [Diagnostic ids reset each launch] → Acceptable: records correlate within a
  launch, which is what the spec permits.

## Migration Plan

Additive. No persisted state, no settings, no protocol version. Rollback is a
revert; an older server ignores `fresh` and an older client never sends it.

## Open Questions

- Whether the stale row's cause lies in event delivery inside the packaged
  Electron main process (two overlapping recursive watches on a tree that
  contains nested worktrees and `node_modules`) or in the service. The records
  from this change are meant to answer it; no ADR needs revisiting until they
  do.
