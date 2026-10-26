## Why

Once a worktree's pull request is merged on Gitea, its folder card says `no PR`.
`terminay-gitea` lists only open pull requests, so a merged one drops out of the
listing and the card falls back to saying no pull request exists — the opposite
of what happened. The property model and the card already carry and label a
`merged` state; the extension never publishes it.

## What Changes

- `terminay-gitea` lists the repository's closed pull requests alongside its
  open ones on each refresh, and matches a worktree to a merged pull request for
  its tracked branch when no open one exists. An open pull request still wins.
- A merged pull request is published with state `merged`. A pull request
  closed without being merged is not shown.
- A merged pull request chip is drawn in purple.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `built-in-extensions`: the Gitea refresh lists closed pull requests too, and
  the mapping publishes merged pull requests.

## Impact

- `extensions/gitea/src/refresh.ts`, `extensions/gitea/src/mapping.ts`.
- `src/components/folders/foldersTree.css` — the merged chip's colour.
- Tests: `extensions/gitea/test/refresh.test.mjs`.
