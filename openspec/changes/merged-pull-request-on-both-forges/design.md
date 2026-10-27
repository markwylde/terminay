## Context

Both forge extensions publish a worktree's pull request through the shared
`WorktreeProperties` model, which already has a `merged` state. The folder card
already draws it in purple.

- `terminay-gitea` lists open pull requests and the 50 most recently updated
  closed ones, then matches on `head.ref === trackedBranch`. When a merge deletes
  the head branch, Gitea reports `head.ref` as `refs/pull/<n>/head`, while
  `head.label` keeps the branch name. On `puzed/atlas`, every merged pull request
  from #298 to #312 looks like this, and open pull requests carry the branch name
  in both fields.
- `terminay-github` sends one GraphQL request per 50 branches. For each branch it
  asks `ref(qualifiedName: "refs/heads/<branch>")` for its commit rollup and
  `associatedPullRequests(states: OPEN)`. A merged pull request is never in that
  result, and once the branch is deleted the `ref` is `null`, so the worktree
  publishes nothing.

## Goals / Non-Goals

**Goals:**

- A worktree whose pull request merged shows it as `merged` on both forges,
  whether or not the head branch still exists.

**Non-Goals:**

- Showing pull requests that were closed without being merged.
- Any card or UI change.
- Showing checks for a merged pull request whose branch is gone on GitHub.

## Decisions

**Gitea: match on `head.ref` or `head.label`.** `matchPullRequest` accepts a
pull request when either field equals the tracked branch, and keeps the existing
head-repository check. A fork's label has the form `owner:branch`, so it never
equals a bare branch name, and the head-repository check still excludes forks.
Alternative considered: parse `refs/pull/<n>/head` and match on the head SHA
instead. That needs the worktree's remote head SHA, which the context does not
reliably carry, and the label already holds the answer.

**GitHub: a repository-level merged listing in the same request.** The query
adds
`pullRequests(states: MERGED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC})`
on `repository`, selecting only `number title url headRefName headRepository { nameWithOwner }`.
`headRefName` is stored on the pull request and survives deletion of the
branch. Every chunked request includes it, so the rule "one request per 50
branches" still holds and no request is added. Matching goes through the
branch's open pull requests first, then this list in order, which is most
recently updated first.

Alternative considered: `associatedPullRequests(states: [OPEN, MERGED])` on
each branch ref. That cannot find anything once the branch is deleted, which is
the usual state after a merge. A second alternative, asking the worktree's head
commit for its associated pull requests, needs a commit SHA the context does not
reliably carry, and adds a field per branch.

**GitHub checks for merged pull requests come from the branch only.** The
merged listing carries no commit rollup, which keeps the query's node cost flat.
If the branch still exists, its head commit's rollup is shown, as today. If it
is gone, no checks are published. A merged card's checks are of little use, and
50 nested rollups of 100 contexts each would dominate GraphQL cost.

**`toProperties` no longer returns early on a missing ref.** A `null` ref now
means "no checks, no open pull request", and the merged match still runs.

Boundary: both changes stay inside the extensions, which publish through the
validated property model (ADR-0011). No new refresh is scheduled, and the
existing request count is unchanged on GitHub (ADR-0028).

## Risks / Trade-offs

- [A branch name reused after an old merge, with no new pull request, shows the
  old pull request as merged] → This is the behaviour the Gitea change already
  accepted. It is accurate about that pull request, and rare in a worktree flow.
- [A merge older than the 50 most recently updated merged pull requests is not
  found] → The card falls back to its no-pull-request state, as it does today.
  Busy repositories rarely keep a merged worktree around that long.
- [GitHub Enterprise servers with an older schema] → `pullRequests(states:,
  orderBy:)` has been in the GraphQL schema for years, and the existing fallback
  for missing count fields is unaffected.
