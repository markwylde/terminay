## 1. Selection

- [x] 1.1 Add a `randomSource: () => number = Math.random` parameter to the
      selection function and return a random palette entry when no in-use colour
      carries a hue. Verified by the tests in 2.x.
- [x] 1.2 Rename `getDeterministicProjectTabColor` to `getProjectTabColor` and
      update its call sites, including `getRandomProjectTabColor` and
      `createProjectTab`. Verified by `npm run typecheck:workspaces` exiting zero
      and no remaining references to the old name.

## 2. Tests

- [x] 2.1 Update existing colour tests to pin `randomSource` wherever they assert
      an exact first colour. Verified by the suite passing.
- [x] 2.2 Test: with an empty in-use set, a pinned random source selects the
      expected palette entry, and different sources give different colours.
      Verified by the test passing.
- [x] 2.3 Test: with a non-empty in-use set, the result is unchanged when the
      random source is varied, proving randomness applies only to the first pick.
      Verified by the test passing.
- [x] 2.4 Test: the default `Math.random` path yields more than one distinct
      first colour across many calls. Verified by the test passing.

## 3. Verification

- [x] 3.1 Run `npm run lint` and `npm run typecheck:workspaces`. Verified by both
      exiting zero.
- [x] 3.2 Run `node --test src/workspace/projectTabModel.test.ts`. Verified by all
      tests passing.
- [x] 3.3 Run `openspec validate --all --strict`. Verified by it reporting all
      items valid.
