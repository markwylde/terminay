## 1. Gitea

- [x] 1.1 Add a test to `extensions/gitea/test/refresh.test.mjs`: a merged pull request with `head.ref` `refs/pull/311/head` and `head.label` equal to the worktree's branch is published as `merged`, and a fork's pull request whose label is `owner:branch` is not matched. Verified by the test failing before 1.2 and passing after it, under `npm test -w terminay-gitea`.
- [x] 1.2 In `extensions/gitea/src/mapping.ts`, make `matchPullRequest` accept `head.ref` or `head.label` equal to the tracked branch, keep the head-repository check, and add `label` to `GiteaPullRequest`. Verified by 1.1 passing.

## 2. GitHub

- [x] 2.1 Add tests to `extensions/github/test/refresh.test.mjs` and `parsing.test.mjs` for each new scenario: merged with the branch present (state `merged`, branch checks), merged with the ref `null` (state `merged`, no checks), open wins over merged, a fork's merged pull request is not matched, and a refresh with five branches still makes one GraphQL request. Verified by the tests failing before 2.2–2.4 and passing after them, under `npm test -w terminay-github`.
- [x] 2.2 In `extensions/github/src/query.ts`, add `mergedPullRequests: pullRequests(states: MERGED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number title url headRefName headRepository { nameWithOwner } } }` under `repository`. Verified by a parsing test asserting the query text and that branch names still travel only as variables.
- [x] 2.3 In `extensions/github/src/mapping.ts`, give `toPullRequest` a `merged` input that yields state `merged`, and make `toProperties` take the merged list, drop its early return on a `null` ref, and fall back to the first merged pull request matching branch and head repository. Verified by 2.1 passing.
- [x] 2.4 In `extensions/github/src/refresh.ts`, read `repository.mergedPullRequests.nodes` from each response and pass it to `toProperties`. Verified by 2.1 passing.

## 3. Delivery

- [x] 3.1 Archive `gitea-shows-merged-pull-request` and `github-worktree-status` first, so the requirements this change modifies exist in `openspec/specs/built-in-extensions/spec.md`. Verified by `openspec validate --all --strict` exiting zero.
- [x] 3.2 Run `npm run lint`, `npx tsc --noEmit -p .`, and both extensions' tests. Verified by all exiting zero.
- [ ] 3.3 Open the pull request on `origin` with `tea`, and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
- [ ] 3.4 After the merge, confirm the `fix/mention-menu-arrow-keys` worktree in atlas shows #311 as `merged`. Verified by a screenshot of the folder card.
