---
name: openspec-git-discipline
description: Apply Terminay’s worktree and pull-request conventions when proposing, implementing, verifying, syncing, or archiving an OpenSpec change. Use alongside the relevant OpenSpec workflow.
license: MIT
---

# OpenSpec Git Discipline

## One change, one worktree and pull request

Never write changes in the main clone. Use a git worktree, and keep a change’s
proposal, design, ADR, delta specs, tasks, implementation, verification, and
spec sync together on its branch. A separate proposal-only pull request is
optional when the user requests it; it is not a prerequisite for implementation.

Prepare the planning artifacts before implementing product behavior, following
the selected schema’s dependencies and the user’s requested scope. Apply can
read artifacts from the current worktree, including uncommitted artifacts.
They do not need to exist on `main`, be committed, or be merged first. Do not
insert a commit or merge checkpoint between artifacts or lifecycle phases.
A request to plan or explore alone does not authorize implementation.

Before editing, inspect `git status --short` and the current worktree and branch.
Preserve unrelated changes. Use the same worktree and branch for subsequent
phases unless the user asks otherwise. Follow existing authorization for branch
creation, commits, pushes, pull requests, and merges; changing phase does not
require asking for that authorization again.

## Verification, sync, and archive

Keep task checkboxes grounded in their stated verification. Do not mark tests,
manual checks, or CI complete merely because the implementation exists or the
specs validate.

Spec sync and archive can run in the change’s worktree before the pull request
merges. They do not require a checkout of `main` or a prior implementation merge.
Follow the selected workflow’s completion and sync checks. Resolve overlapping
deltas in dependency order, preserve independent requirements and scenarios,
and leave incomplete work explicit. Do not archive unfinished work merely to
make the active-change list shorter.

Run `openspec validate --all`; use `--archived` as a separate check when archive
content is affected. Report pre-existing failures separately from new failures.

## Repository delivery

Use `origin` (Gitea) and the `tea` CLI for pull requests and CI. The `github`
remote is a mirror. If pull-request delivery is requested, read back every head
commit status and require `success` or `skipped` before reporting it complete.
Do not automatically push or merge merely because an OpenSpec phase finished.

## Updating the generated skills

Refreshing OpenSpec’s generated instructions means running `openspec update`
from the selected worktree, using the current stable CLI. It does not mean
syncing or rewriting product specifications. Keep upstream-generated skills
under OpenSpec’s generator; this file contains the repository-specific git
conventions and is maintained separately.
