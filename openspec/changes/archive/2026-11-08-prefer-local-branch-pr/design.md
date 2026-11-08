## Context

Gitea's `trackedBranch` prefers the upstream. `matchPullRequest` uses it as its only candidate, so a feature branch tracking main cannot match its PR. Refresh already fetches open and merged candidates and uses the matched PR's SHA for checks.

## Goals / Non-Goals

Goals: local-name-first matching with upstream fallback, deterministic precedence, and checks tied to the selected PR. Non-goals: GitHub changes, Git configuration repair, pagination changes, UI changes, and changing status lookup when no PR exists.

## Decisions

Try distinct local and upstream names in that order in `matchPullRequest`. Search the existing ordered PR list for each name, retaining repository filtering and deleted-branch label matching. Branch priority precedes PR state priority: a local merged PR wins over an upstream open PR. Keep `trackedBranch` for no-PR status lookup and do not change refresh request counts. Detached worktrees match nothing.

Boundary: all matching stays inside the server-hosted extension; repository contexts, credential access, project scoping, and renderer publication contracts do not change. Upstream-only selection was rejected because it reproduces the reported failure; local-only selection would lose differently named remote branches.

## Risks / Trade-offs

A reused local branch with a historical merged PR may now beat an upstream open PR. This follows the explicit branch precedence; test it. The bounded remote PR lists can still omit older PRs; pagination is outside this fix.

## Migration Plan

Deploy the extension normally; no stored data or Git configuration changes. Roll back the matcher if needed.

## Open Questions

None.

## Review resolutions

Branch identity precedes PR state because an upstream such as main need not identify this worktree's work. Searching both names for open PRs first would associate a base-branch PR with the feature worktree despite a local match. No commit guard is added: local commits may advance beyond a PR head, and merged worktrees still need their completion state. Reused branch names remain a documented limitation of name-based matching.

Keep existing metadata and publication semantics: absent head-repository metadata is accepted, and a branch match with invalid publication fields suppresses the PR rather than changing branch identity. Deleted-branch labels remain candidates. Validation records unrelated baseline failures separately.
