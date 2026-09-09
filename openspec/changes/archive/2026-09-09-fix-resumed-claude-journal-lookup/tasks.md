## 1. Resolve a session's journal by its id

- [x] 1.1 Add a bounded lookup in `extensions/agent-claude-code/src/provider.ts` that lists `.claude/projects` at depth 1 for `.jsonl` files, keeps only entries whose basename is exactly `<sessionId>.jsonl`, and returns a handle only when the journal's own first record names that session. Verified by a new case in `test/binding.test.mjs` where the journal for the named session exists only under another project directory and the terminal binds it.
- [x] 1.2 Use that lookup as `journalFor`'s fallback, after the cwd-derived path and only when the derived journal is absent. Verified by an existing binding case still passing with no listing performed when the derived journal exists — assert the derived path answers by keeping the other directory empty.
- [x] 1.3 Return no journal when more than one candidate survives verification. Verified by a case with the same session id under two project directories asserting `not-bound` and no events.
- [x] 1.4 Return no journal when the host reports the listing truncated. Verified by a case whose fixture listing is truncated asserting `not-bound`, so a limit never yields a guessed binding.

## 2. Keep the rules the fix must not weaken

- [x] 2.1 Update `test/binding.test.mjs:185` — "a journal in another project directory is not admitted" — to the rule that now applies: a journal elsewhere whose id is **not** the one the session file names is still refused. Verified by that case asserting `not-bound` for a foreign session id under another directory.
- [x] 2.2 Confirm the session file remains the only thing that decides which conversation a terminal holds, and that a journal whose first record names a different session is still rejected wherever it was found. Verified by the existing session-file and header cases in `test/binding.test.mjs` and `test/session-file.test.mjs` passing unchanged.
- [x] 2.3 Confirm no timestamp, filename proximity, or newest-file ordering enters the lookup. Verified by a case where an older and a newer journal for other sessions sit beside the target and the target still binds.

## 3. Conversation switch inside a live session

- [x] 3.1 Resolve a switched-to conversation's journal through the same path, so `rootSource` follows a conversation whose journal is filed under another directory. Verified by a case in `test/lifecycle.test.mjs` (or `resume.test.mjs`) where the session file is rewritten to a session whose journal lives elsewhere and the row follows it.
- [x] 3.2 Confirm an unresolvable switch leaves the existing binding alone rather than retiring it. Verified by a case asserting the bound row survives a switch record naming a session with no findable journal.

## 5. The lookup is bounded by the file it asks for

- [x] 5.1 Add an optional exact-name filter to `AgentDirectoryListOptions`, so a listing may declare the filenames it wants. Verified by typecheck and by the extension compiling against it.
- [x] 5.2 Apply the filter in `localAgentObservation` before any limit is charged, and refuse a name that is not a single path segment. Verified by a case in `packages/server-core/test/extension-local-agent-observation.test.mjs` where an unfiltered walk truncates before the wanted file and the named walk returns it untruncated, plus rejection cases for a traversal name and an empty list.
- [x] 5.3 Mirror the filter in the test harness so extension fixtures exercise the same rule the host applies. Verified by the Claude Code suite passing against it.
- [x] 5.4 Declare the journal filename in the provider's lookup. Verified by a case where 300 unrelated journals sit before the target and it still binds.
- [x] 5.5 Keep the fail-closed branch for a genuinely truncated listing. Verified by a case where 300 directories claim the same session id and nothing binds.

## 4. Verification

- [x] 4.1 Run `npm run test --workspace terminay-agent-claude-code`. Verified by the suite passing.
- [x] 4.2 Run `npm run test:agents`. Verified by it passing, including the other providers' suites and the agent UI tests — 23 suites, zero failures.
- [x] 4.3 Run `npm run lint` and `npm run typecheck:workspaces`. Lint is clean. Typecheck reports three errors in `terminay-agent-opencode`, which this change does not touch: a worktree resolves `@terminay/extension-api` through the main checkout's `node_modules` symlink, whose built `dist` is older than its own source and lacks `AgentProcessSnapshot.arguments`. Building that package and resolving it locally clears them, and CI builds from source, so it is a local resolution artefact rather than a defect on this branch.
- [ ] 4.4 Reproduce the original failure against the real CLI: resume a conversation in a directory other than its origin and confirm the terminal binds, using the agent observation diagnostics to show `bound` rather than repeated `admitted (not-bound)`. Verified by reading the produced records.
