## ADDED Requirements

### Requirement: Unpushed worktree work

A worktree listing SHALL report, for each worktree, whether it holds unpushed commits and the size of its unpushed work as lines added and lines removed. Where the worktree's branch has an upstream that exists, its unpushed commits SHALL be the commits that upstream lacks. Where the branch has no upstream, or its upstream no longer exists, its unpushed commits SHALL be the commits no remote-tracking branch holds, and a branch whose resulting tree is already present on the default branch SHALL hold none. The size of unpushed work SHALL count the unpushed commits and the uncommitted changes to tracked files. A value that cannot be measured SHALL be reported as unknown rather than as zero. The measurement SHALL be refreshed when a push or a fetch moves a remote-tracking branch.

#### Scenario: Pushed branch

- **WHEN** a worktree's branch has every commit on its upstream and no uncommitted changes
- **THEN** the listing reports no unpushed commits and an unpushed size of zero

#### Scenario: Commits ahead of the upstream

- **WHEN** a worktree's branch is two commits ahead of its upstream, and those commits add five lines
- **THEN** the listing reports unpushed commits and five unpushed lines added

#### Scenario: Branch never pushed

- **WHEN** a worktree's branch has no upstream and holds a commit that no remote-tracking branch has and the default branch lacks
- **THEN** the listing reports unpushed commits

#### Scenario: New worktree with no commits of its own

- **WHEN** a worktree's branch has no upstream and every commit on it is on a remote-tracking branch
- **THEN** the listing reports no unpushed commits

#### Scenario: Squash-merged branch whose remote branch was deleted

- **WHEN** a worktree's branch was squash-merged, its resulting tree is present on the default branch, and its upstream no longer exists
- **THEN** the listing reports no unpushed commits

#### Scenario: A push is seen

- **WHEN** a branch with unpushed commits is pushed
- **THEN** the listing reports no unpushed commits for its worktree without the user refreshing
