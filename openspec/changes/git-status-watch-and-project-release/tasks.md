## 1. Reproduce

- [x] 1.1 Add `packages/server-core/test/project-close-releases-resources.test.mjs`.
  It opens a project in a real Git repository with five terminals, closes it,
  and asserts that every PTY is killed and that no Git command runs afterwards.
  Verified by the test failing on `main` with the runner still recording
  `worktree list`, `status`, `merge-tree`, and other commands after
  `project.close`.
- [x] 1.2 Switch that test from the 1 s poll to an injected fake watcher once
  §3 lands, and make it assert zero runner calls over a quiet window both
  before and after close. Verified by the test passing with no wait longer
  than 150 ms, and passing on five consecutive runs.

## 2. Release a closed project

- [x] 2.1 Add `releaseProject(projectId)` to `workspaceProtocol` options and
  call it after `project.close` is applied, whatever the terminal count.
  Verified by "closing a project with no terminals still releases its
  resources", which observes the host hook.
- [x] 2.2 Add `GitService.releaseProject` (unbind, cancel pending refresh, drop
  fingerprints and cached summaries, release reference-counted watches, bump
  the per-project generation), and route the composition hook to it through
  `ServerGitAdapter`. The composition also releases file observations
  (`ServerFileObservationAdapter.closeProject`) and language sessions
  (`LanguageSessionManager.closeProject`). Verified by the §1 test, plus "a
  listing in flight when its project is released publishes and keeps nothing".
- [x] 2.3 Make `ServerGitAdapter.ensureProjectBound` refuse to bind a project
  the workspace no longer has. It already did: after close, the workspace root
  resolves to null, so no bind happens. `resolveDiscovery` now also refuses to
  write back a binding released while it was discovering. Verified by "a Git
  request for a closed project is refused and binds nothing".
- [x] 2.4 Implement the host `releaseProject` in
  `electron/serverTerminalAuthority.ts`. It deletes the project from
  `fileCatalogProjects`, `documentationProjects`, `mdxRuntimeProjects` (after
  `disposeAll()`), `fileContentProjects`, `fileSessionProjects`, and
  `fileProjectRoots`, and calls `agentScope.removeProject`. File observations
  are released by the composition (2.2). Verified by "closing a project
  releases every per-project map, binding, and watch the host holds" in
  `scripts/server-terminal-authority-host-bookkeeping.test.mjs`.
- [x] 2.5 Implement the same hook in `apps/terminay-server/src/cli.ts` for the
  per-project state it owns (file resolvers, catalogs, MDX runtime, agent
  scope). The CLI runs on import and has no harness for the workspace
  protocol, so this is verified by the source contract
  `apps/terminay-server/test/project-release-contract.test.mjs`. Its Git
  release runs through the shared composition, which the server-core tests
  cover.
- [x] 2.6 Confirm that a project move between views or windows does not
  release anything. Verified by "moving a project to another view releases
  nothing".

## 3. Watch instead of poll

- [x] 3.1 Move `createRefreshSchedule` and `REFRESH_RAMP_MS` from
  `src/workspace/gitRefreshSchedule.ts` to `@terminay/protocol`
  (`refreshSchedule.ts`), and re-point the UI import. Verified by
  `packages/protocol/test/refresh-schedule.test.mjs` (9/9) and
  `npm run test:boundaries`.
- [x] 3.2 Define `GitStateWatcher` in `gitService/types.ts` and implement
  `NodeGitStateWatcher` on `fs.watch` (recursive) as the default. Drop events
  under `objects/`, `logs/`, `hooks/`, `info/`, `lfs/`, and `modules/`, and
  `*.lock`, `FETCH_HEAD`, `COMMIT_EDITMSG`, tags, and stash. The attribution
  lives in `gitService/observation.ts`. Verified by
  `git-node-watcher.test.mjs` against a real repository: a file save, a commit,
  and `git checkout -b` are each observed and attributed, and
  `git hash-object -w`, which writes objects only, attributes nothing. The
  planned `git gc` check was replaced because `gc` packs refs, which is a
  genuine `packed-refs` change. Also verified by
  `git-observation-attribution.test.mjs`.
- [x] 3.3 Derive the per-repository watch set (the common gitdir recursively,
  which covers `HEAD`, `index`, `refs/`, `packed-refs`, `worktrees/`, and
  every linked gitdir, plus each working tree not already inside another),
  reference-count it across projects that share the repository, and re-derive
  it from each listing. Verified by fake-watcher tests: a new worktree is
  watched, a removed one is unwatched, and releasing one of two projects on
  the same repository keeps the watches.
- [x] 3.4 Map each event to a worktree (innermost wins) or to all, and feed a
  per-repository ramp schedule that calls `worktrees()` with that scope.
  Verified by counting `status` commands per worktree: an edit in one worktree
  measures only that one, a linked `HEAD` change only its worktree, and
  `packed-refs` all of them.
- [x] 3.5 Add dirty tracking to the cached listing. Serve `worktrees()` from
  cache while the watch is live and nothing is dirty. Mark it dirty from watch
  events and after every repository mutation (pull, move, remove, and
  remove-clean share `enqueueRepositoryMutation`). Verified by "the follow-up
  listing is cached", which spawns zero Git commands, and by "a mutation
  invalidates the cache", using `removeWorktree` as the mutation.
  Measurements of one repository are serialized, and the cache is not trusted
  while one is in flight. Verified by "a listing that overlaps a watch-driven
  refresh never caches summaries older than the change", which failed before
  the serialization.
- [x] 3.6 On a watcher `error` or `close`, or on a setup failure, mark the
  repository unavailable, close its watches, clear its cache, publish one
  unattributed `git.status.changed`, and measure on every request with no
  timer. Verified by "a failed watch leaves the repository measured on demand,
  never on a timer", which injects `ENOSPC`.
- [x] 3.7 Remove `startStatusPoll`, `stopStatusPoll`, `statusPollTimers`, and
  `statusPollIntervalMs`, and make `close()` tear down watches, schedules, and
  in-flight refreshes (`runGit` refuses once the service is closed or its
  caller is aborted). Update the tests that passed `statusPollIntervalMs`, and
  rewrite the poll assertion in
  `scripts/file-explorer-git-status-stability.test.mjs`. Verified by `grep`
  finding no `statusPoll` in `packages/server-core/src`, and by "close tears
  down every watch and schedule". The runner also sets `GIT_OPTIONAL_LOCKS=0`,
  so the server's own `git status` never rewrites the index it watches.

## 4. Prove the result

- [x] 4.1 Unit level: with a real repository, an idle open project and a
  closed project each run zero Git commands. Verified by the tests in §1–§3
  over real quiet windows. No timer exists while a repository is idle, so the
  length of the window does not change the result.
- [x] 4.2 Server level, against real repositories with the production runner
  and watcher: bind, stay idle for 60 s, close, and wait another 60 s.
  Verified by `openspec/adr/evidence/git-watch-idle-spawns.md`: 0 spawns idle
  and 0 after close. One run recorded 8 idle spawns, all traced to real index
  rewrites by the installed pre-fix app.
- [ ] 4.3 Packaged app on the reporting machine (ten projects, five terminals
  each): count `git` children from the process table while idle and after
  closing everything. This needs the reporting machine and a build of this
  branch.

## 5. Gate

- [x] 5.1 `npm run test:ci --workspace @terminay/server-core` passes (773/773).
- [x] 5.2 `npm run lint` and `npm run typecheck:workspaces` pass (lint's 18
  warnings are all in files this change does not touch).
- [x] 5.3 `npm run smoke` passes.
- [ ] 5.4 `npm run test:e2e` passes in Docker.
- [x] 5.5 `npx openspec validate --all` reports every item valid (49/49).
- [ ] 5.6 Every pull-request status on the head commit is `success` or
  `skipped`, read back from Gitea's
  `/repos/markwylde/terminay/commits/<head>/statuses`.
