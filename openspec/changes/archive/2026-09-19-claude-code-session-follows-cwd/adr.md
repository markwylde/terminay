# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-16
- Reviewer: Mark Wylde
- Change: claude-code-session-follows-cwd

## In-Force ADR Context Reviewed

- openspec/adr/0022-watch-do-not-poll.md - the session file is still read only when the sessions directory reports a change; the relocated journal is followed by the same watcher the original was. No timer or process sampling is added.
- openspec/adr/0024-providers-name-the-directories-they-await.md - reviewed; binding is unchanged and no wait set changes. A relocated journal that is not yet present is retried on the next session-file change rather than by a new watch.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - the relocation fixture is the captured shape of a real `EnterWorktree`: the session file rewritten with the worktree cwd and the journal moved, with its history, to the worktree's project directory.
- openspec/adr/0011-security-trust-boundary-model.md - the session file and journal are still resolved through the terminal context's broker beneath `.claude/sessions` and `.claude/projects`; a cwd change cannot bind a journal the session id does not name.
- openspec/adr/0020-per-operation-canonical-roots.md - reviewed; the relocated journal is resolved fresh, not from a cached handle.

Superseded and therefore not in force: 0007, 0008, 0009.

## Repository-Level ADRs Created

None. The decision that a bound session's cwd is data rather than identity is a provider-local reading of evidence the CLI already writes, recorded in the capability spec; it establishes no pattern beyond this provider.
