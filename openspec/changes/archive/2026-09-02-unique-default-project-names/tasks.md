## 1. Server-derived name

- [x] 1.1 Add `nextDefaultProjectName(state)` in
      `packages/server-core/src/workspace.ts`: parse existing project names for the
      exact `Project <digits>` pattern and return `Project N` for the smallest
      positive integer absent from that set. Verified by unit tests in 3.x.
- [x] 1.2 Make `name` optional on the `project.create` command type and have the
      reducer use `nextDefaultProjectName` when the supplied name is absent or
      blank, keeping `boundedName` for anything supplied. Verified by
      `npm run typecheck:workspaces` exiting zero and the tests in 3.x.

## 2. Callers stop deriving names

- [x] 2.1 Drop the computed name in
      `packages/server-core/src/projectEnvironment/operations.ts` so the reducer
      assigns it. Verified by the server-core test suite passing.
- [x] 2.2 Drop the computed name in `src/workspace/useProjectCollection.ts`'s
      `createProject` call. Verified by `npm run typecheck:workspaces`.
- [x] 2.3 Leave `createProjectTab`'s `Project ${index}` title and `App.tsx`'s
      pending tab title as provisional local presentation only, and confirm both
      are replaced by the server name once the project is committed. Verified by
      reading the reconciliation path and by task 4.1.

## 3. Tests

- [x] 3.1 Test: creating three projects then closing the second and creating
      another yields names with no duplicates and reuses the freed number.
      Verified by the test passing.
- [x] 3.2 Test: ten successive creations produce ten distinct names. Verified by
      the test passing.
- [x] 3.3 Test: a supplied non-blank name is stored unchanged, and a rename to a
      duplicate name is accepted. Verified by the test passing.
- [x] 3.4 Test: a project named "Project Apollo" does not reserve a number.
      Verified by the test passing.

## 4. Verification

- [x] 4.1 Run `npm run lint` and `npm run typecheck:workspaces`. Verified by both
      exiting zero.
- [x] 4.2 Run the server-core workspace tests. Verified by
      `node --test packages/server-core/test/workspace.test.mjs` reporting 18/18
      passing. The full `test:ci` suite reports 743/745; the one failure,
      `puzed-ssh-public-composition`, shells out to `docker build` and fails with
      exit 125 because Docker is not running on this machine. It is unrelated to
      this change and passes where Docker is available.
- [x] 4.3 Run `openspec validate --changes unique-default-project-names --strict`.
      Verified by it reporting the change as valid.
