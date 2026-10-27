## Why

A worktree whose pull request has merged never shows `merged` on its folder
card. On Gitea the card shows nothing; on GitHub it shows `no PR` or nothing.
That is the moment a person most wants to know, because it says the worktree
is finished and can be cleaned up.

Gitea: merging usually deletes the head branch, and Gitea then reports the pull
request's `head.ref` as `refs/pull/<n>/head` instead of the branch name. The
extension matches on `head.ref` alone, so a merged pull request whose branch was
deleted never matches. On `puzed/atlas` every merged pull request from #298 to
#312 reports `ref=refs/pull/<n>/head`, while `head.label` still carries the
branch name.

GitHub: `terminay-github` asks each branch ref for its open pull requests only,
so it never sees a merged one. When the branch has been deleted the ref no
longer exists, so asking the ref can never find it.

## What Changes

- `terminay-gitea` matches a pull request to a worktree when either its
  `head.ref` or its `head.label` equals the worktree's tracked branch, so a
  merged pull request is still found after its branch is deleted.
- `terminay-github` asks, in the same GraphQL request it already makes, for the
  repository's 50 most recently updated merged pull requests. A worktree with no
  open pull request for its tracked branch is matched to the most recent merged
  one, and it is published with state `merged`. An open pull request still
  wins, and a pull request closed without merging is not shown.
- A merged GitHub pull request is published even when its branch no longer
  exists on GitHub, which is the usual case after a merge.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `built-in-extensions`: Gitea pull request matching also accepts the head
  label; GitHub's refresh request includes recent merged pull requests, and
  its mapping publishes merged pull requests.

## Impact

- `extensions/gitea/src/mapping.ts` (`matchPullRequest`).
- `extensions/github/src/query.ts`, `mapping.ts`, `refresh.ts`.
- Tests: `extensions/gitea/test/refresh.test.mjs`,
  `extensions/github/test/refresh.test.mjs`,
  `extensions/github/test/parsing.test.mjs`.
- The card already styles `merged` in purple (`foldersTree.css`); no UI change.
- This change builds on the requirements added by the active changes
  `gitea-shows-merged-pull-request` and `github-worktree-status`. Those are
  archived before this one, so their requirements are in the main spec when
  this change's deltas are applied.
