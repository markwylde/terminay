## ADDED Requirements

### Requirement: Server-owned worktree pull

Pulling a worktree SHALL be server-owned and identity-bound, and SHALL
fast-forward only. The server SHALL resolve the branch to pull from the
worktree's configured upstream. When the branch has no configured upstream, the
server SHALL fast-forward from the branch of the same name on the repository's
remote when exactly one such remote branch exists, and SHALL report an absent
remote otherwise. A pull the server does not apply SHALL carry the Git failure
that prevented it.

#### Scenario: Configured upstream

- **WHEN** a clean, attached worktree whose branch has a configured upstream is pulled
- **THEN** the server fast-forwards the worktree from that upstream

#### Scenario: Branch without a configured upstream

- **WHEN** a clean, attached worktree is pulled whose branch has no configured upstream but whose name matches a branch on the repository's remote
- **THEN** the server fast-forwards the worktree from that remote branch

#### Scenario: No matching remote branch

- **WHEN** a worktree is pulled whose branch has neither a configured upstream nor a matching remote branch
- **THEN** the pull is not applied
- **AND** the result reports that the remote branch is absent

#### Scenario: Failed pull carries its cause

- **WHEN** Git refuses or fails the pull
- **THEN** the result is not applied and carries the Git failure message

### Requirement: Worktree pull feedback

A worktree pull SHALL be visible while it runs and SHALL never fail silently.
The Worktrees panel SHALL mark a worktree as pulling from the moment the pull
starts until the server answers, and SHALL NOT start a second pull for a
worktree that is already pulling. A pull the server does not apply SHALL be
reported to the user with the server's failure message.

#### Scenario: Pull in progress

- **WHEN** a user pulls a worktree from origin
- **THEN** that worktree row shows it is pulling until the server answers

#### Scenario: Pull is not started twice

- **WHEN** a worktree is already pulling
- **THEN** its pull action is unavailable

#### Scenario: Pull failure is reported

- **WHEN** the server answers a pull with a result it did not apply
- **THEN** the failure is reported to the user with the server's message

#### Scenario: Pull success clears the Git failure

- **WHEN** the server applies a pull
- **THEN** no Git failure is displayed and the worktree row stops showing it is pulling
