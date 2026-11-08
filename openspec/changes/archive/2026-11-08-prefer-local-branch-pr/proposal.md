## Why

A worktree can show “no PR” even though its feature branch has an open Gitea pull request, because it tracks `origin/main`. Tracking a base branch is valid Git configuration and must not hide the feature branch's PR.

## What Changes

- Match Gitea pull requests against the local branch name first, then the configured upstream if no eligible local match exists.
- Preserve same-repository filtering, open-before-merged selection within each branch, and status lookup at the matched PR head.
- Cover the reported case and precedence/fallback cases with mapping and refresh tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `built-in-extensions`: Gitea pull request matching prefers the local branch over its upstream.

## Impact

Gitea extension mapping, tests, and documentation. No API, dependency, renderer, credential, polling, or Git configuration changes. GitHub behavior is outside this fix. Screenshots are unnecessary because presentation does not change.
