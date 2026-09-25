## 1. Extension API: worktree insight contribution

- [x] 1.1 Add `worktree-observation` permission, `contributes.worktreeInsights` manifest entry, and validation in `packages/extension-api` — verified by validation unit tests (accept insight-only package; refuse registration without the permission; refuse undeclared id)
- [x] 1.2 Add the property model types (`WorktreePullRequest`, `WorktreeChecks`, `WorktreeProperties`) and a pure validator (bounds, counts sum to total, credential-free HTTPS URLs, 100-item cap) — verified by unit tests covering each rejection scenario in the `worktree-properties` spec
- [x] 1.3 Add `RepositoryContext`, `WorktreeInsightSource`, sign-in request and per-origin credential types, and `context.worktrees.registerInsightSource` to `ExtensionContext`; bump the API minor version — verified by `npm run typecheck` and an API surface test

## 2. Server host: repository contexts, publication, credentials

- [x] 2.1 Carry `worktreeInsights` registrations across the child/host IPC protocol (register, context issue/re-issue/cancel, publish, sign-in request, credential resolve/reject, credential-available notification) — verified by host protocol unit tests
- [x] 2.2 Build the host insight registry: issue a context per open Git project from `GitService` data, re-issue on worktree set/branch/upstream/head change, cancel on project close/extension disable/host failure — verified by unit tests for each scenario in "Host-issued repository context"
- [x] 2.3 Validate and store properties per `(projectId, worktreeId, extensionId)`; reject unissued ids; drop on context cancel and extension dispose — verified by unit tests
- [x] 2.4 Per-origin vault bindings for sign-in tokens (resolve own origin only, reject removes binding) — verified by unit tests including cross-extension refusal
- [x] 2.5 Sign-in prompt state: de-duplicate per origin, "maybe later" in-memory suppression, "don't ask again" persisted per extension and re-enable path — verified by unit tests

## 3. Protocol and client delivery

- [x] 3.1 Add project-scoped worktree-property snapshot and change events, and sign-in prompt state/response operations, to the application protocol — verified by protocol tests that a client of another project receives nothing
- [x] 3.2 Merge worktree properties into the client Git workspace model keyed by worktree path — verified by adapter unit tests

## 4. Worktrees panel UI

- [x] 4.1 Render the pull request chip and checks chip on worktree rows with theme tones and accessible names; no change for rows without properties — verified by presentation tests in `scripts/worktree-properties.test.mjs` (tone, accessible names, empty rows) and typecheck
- [x] 4.2 Pull request chip opens the URL through the guarded external-link path; checks chip opens a host-rendered list whose items open their URLs — verified by presentation tests (ordering, unsafe-link dropping) and the adapter test for `git.worktree.properties`
- [x] 4.3 Sign-in modal with Yes / No, maybe later / Don't ask me about Gitea again, secret token field and guarded token-page link, and a Settings switch to re-enable prompts — verified by the service and adapter tests for choices and preferences, and typecheck

## 5. Gitea extension

- [x] 5.1 Scaffold `extensions/gitea` (`terminay-gitea`, `com.terminay.gitea`) following `builtin-agents`; add to `extensions/builtins.json` and the built-in inventory — verified by the built-in staging/inventory tests
- [x] 5.2 Remote parsing (HTTPS, `ssh://`, scp-style → HTTPS origin and `owner/repo`) and `/api/v1/version` probe with per-origin cache — verified by unit tests
- [x] 5.3 Credential resolution: tea config file (XDG, macOS, Linux paths), matched by origin, held in memory and refreshed on file change or 401; fallback to vault; otherwise request sign-in; never spawn `tea` — verified by unit tests with fixture configs
- [x] 5.4 Refresh loop per context: immediate on issue/re-issue, interval floor (see 7.2), failure back-off, stops on cancel; one pulls listing plus one status per worktree with an upstream — verified by unit tests with a fake clock and fetch
- [x] 5.5 Mapping: PR ↔ worktree by head branch and repository; draft detection; status state mapping; items truncated to 100 — verified by unit tests against recorded Gitea JSON
- [x] 5.6 README for the extension — verified by review

## 6. Verification

- [x] 6.1 `npm run lint`, `npm run typecheck`, and the unit test suites pass — verified by command output
- [x] 6.2 `openspec validate --all` passes — verified by command output
- [x] 6.3 Run the real server stack (built Gitea extension in an extension host, GitService, Git adapter, tea token) against this repository's Gitea and confirm worktrees with open pull requests list their pull request and checks — verified by the live run listing #286, #287, #288 with 15/15 passing and linked check items (a desktop screenshot was not possible: screen recording is not permitted in this session)

## 7. Active-project cadence

- [x] 7.1 Contexts carry `active` from the workspace's active projects, and a change of activity re-issues them — verified by `worktree-insight-service.test.mjs`
- [x] 7.2 The Gitea extension refreshes active projects every 10 s, others every 45 s, and at once on focus — verified by `extensions/gitea/test/refresh.test.mjs`
