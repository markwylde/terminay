## 1. Extension

- [x] 1.1 Add a test to `extensions/gitea/test/refresh.test.mjs`: a merged pull request for a worktree's branch is published as `merged`, an open one wins over a merged one, and one closed without merging is not shown; a refresh makes two pull request listing requests. Verified by `npm test -w terminay-gitea`.
- [x] 1.2 List closed pull requests in `refresh.ts` and map `merged` in `mapping.ts`. Verified by 1.1 passing.

## 2. Card

- [x] 2.1 Style `.folders-tree__pr--merged` purple in `foldersTree.css`. Verified by `npm run lint`.

## 3. Delivery

- [x] 3.1 Run `openspec validate gitea-shows-merged-pull-request --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all exiting zero.
- [x] 3.2 Open the pull request on `origin` with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
