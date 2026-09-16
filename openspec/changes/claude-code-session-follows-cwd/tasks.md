## 1. Reproduce

- [x] 1.1 Add `extensions/agent-claude-code/test/relocation.test.mjs` with a fixture that binds under one cwd, then rewrites the session file with a worktree cwd while the journal, carrying its history and new records, sits under the worktree's project directory, and finally rewrites the status to `idle`. Verified by the test failing against the unchanged provider with no `agent.done` and no tool events after the move.

## 2. Follow the cwd

- [x] 2.1 In `extensions/agent-claude-code/src/provider.ts`, make the cwd `acceptSessionFile` must match an explicit argument: the observed process cwd at binding, none in `renamedSessions`. Verified by `npm test` in `extensions/agent-claude-code`: the bind-time tests in `binding.test.mjs` and `session-file.test.mjs` still reject a file whose cwd disagrees with the process.
- [x] 2.2 In `renamedSessions`, yield on any change of session id, status, or cwd, comparing each against the last value seen. Verified by the relocation test observing `agent.done` from an `idle` written in the same rewrite as the cwd change.
- [x] 2.3 In `rootSource`, treat a same-session cwd change as a relocation: resolve the journal for the new cwd with `journalFor`, dispose the old follower, inject a relocation chunk, and follow the new journal. A journal that cannot be resolved leaves the status lane running. Verified by the relocation test observing the new journal's tool events and by the existing conversation-switch tests in `shared-project.test.mjs` still passing.
- [x] 2.4 In `extensions/agent-claude-code/src/mapping.ts`, recognise the relocation record and keep every piece of mapping state across it: session, title, status, `idleSince`, children and completed launches. Verified by the relocation test: exactly one `session.started`, no `subagent.done` cancellations, and the row's state unchanged across the replay.

## 3. Checks

- [x] 3.1 Run `openspec validate --all`, `npm run lint`, and `npm test` in `extensions/agent-claude-code`. Verified by all three reporting clean.
- [x] 3.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`. Verified by the status listing itself: pull request #260, head `0e221791`, 21 of 21 statuses `success`, including the real-CLI `agent-claude-code` conformance run. The first run failed on the conformance selection job because the runner that took it carries no `jq`; the job now builds its list with the shell alone. E2E shard 10 failed once on a tab-bar squeeze test unrelated to this change and passed on re-run.
