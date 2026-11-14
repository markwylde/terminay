## 1. Regression tests first

All tests live in `apps/terminay-server/test/standalone-restored-project-files.test.mjs`. Each test starts the standalone CLI on a temporary data root, stops it, and starts it again on the same data root. The holder mode is whatever the CLI selects for that data root; the assertions do not depend on it.

- [x] 1.1 Restored project keeps its access: create a project rooted at a subdirectory through `workspace.project.create`, then restart. After the restart, `files.list`, `files.content-text` of a file in the project, and a Git worktree listing for the project all succeed. Verified by the listing failing with `forbidden` before the fix and the test passing after it.
- [x] 1.2 Missing root: create two projects, delete one root between runs, restart. The server reaches readiness, the gone project is still in the snapshot with no terminal panel, its `files.list` is refused, and the sibling's listing succeeds. Then `project.root.update` points the gone project at a new directory, and its listing succeeds. Verified by the test passing.
- [x] 1.3 Start choice: create a project without a root from a client that speaks `project-start-choice.v1`, so it awaits its start choice, then restart. The server reaches readiness and the project still awaits its start choice. Verified by the test passing.

## 2. Bind restored projects at standalone startup

- [x] 2.1 In `apps/terminay-server/src/cli.ts`, factor the `workspaceOperations.prepareProjectRootUpdate` commit (file maps, `agentScope.setProject`, `folders.projectBound`) into one helper shared with startup. Verified by the existing project-create and root-update tests still passing.
- [x] 2.2 Supply `workspaceStartup.prepare`. It binds every restored project whose `rootOrigin` is not `none` through that helper. A project whose bind fails with `path_missing` is released (`files.releaseProject`, `agentScope.removeProject`, `folders.releaseProject`, and its Git binding) and returned as unavailable. Any other failure is rethrown. Verified by tasks 1.1–1.3 passing.

## 3. Validate

- [x] 3.1 Build with `timeout 1200 npx turbo run build --filter=@terminay/server... --filter=@terminay/client-core`. Then, from `apps/terminay-server`, run `timeout 900 node --test --test-force-exit --test-timeout=120000 test/*.test.mjs`. Verified by a zero exit status, or by any failure being shown to fail identically on `main`.
- [x] 3.2 Run `npx biome lint` (what CI runs) on the touched files, the server package's type check, and `openspec validate --all`. Verified by each command passing.
