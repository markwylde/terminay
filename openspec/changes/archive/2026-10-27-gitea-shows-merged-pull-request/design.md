## Context

`terminay-gitea` lists `pulls?state=open` once per refresh and matches each
worktree to the first pull request whose head is its tracked branch. Gitea's
listing reports a closed pull request's `merged` flag.

## Goals / Non-Goals

**Goals:**

- A worktree whose pull request was merged shows that pull request as merged.

**Non-Goals:**

- Showing pull requests closed without merging.
- The GitHub extension, whose behaviour is specified by the active
  `github-worktree-status` change.

## Decisions

**A second listing, not `state=all`.** The refresh lists open pull requests and
the 50 most recently updated closed ones in parallel. A single `state=all`
listing is capped at 50 too, so a long-lived open pull request could fall out of
it behind recent merges. The cost is one more request per repository per
refresh, inside the existing refresh floors.

**Open first, then merged.** Open pull requests are placed ahead of merged ones
before matching, so a branch reused for a new pull request after a merge shows
the open one. Closed listings are sorted by most recent update, so the latest
merge for a branch wins among merged ones.

## Risks / Trade-offs

- A branch that keeps receiving commits after its pull request merged, with no
  new pull request, shows the old pull request as merged rather than `no PR`.
  That is accurate about the pull request and rare in a worktree flow.
