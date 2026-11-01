## ADDED Requirements

### Requirement: Dashboard shows a panel's pull request and checks

Every panel the dashboard presents, and every agent card for an agent running in a panel, SHALL show the pull request and checks summary of the worktree its folder stands for, worded and coloured as that folder's Folders row shows them. Every panel in one folder SHALL show the same facts. A panel whose folder has neither SHALL show neither. The facts SHALL appear on every view mode and SHALL carry no action of their own.

#### Scenario: Agent card in a worktree with a pull request

- **WHEN** an agent runs in a terminal whose folder's worktree has pull request #99 open with 12 checks running
- **THEN** its Board card shows `PR #99` and `12 running`

#### Scenario: Two terminals in one worktree

- **WHEN** two terminals are in the same folder and its worktree has a pull request
- **THEN** both terminals' cards show the same pull request and checks

#### Scenario: Folder with no pull request

- **WHEN** a panel's folder worktree has no pull request and no checks
- **THEN** its card shows no pull request or checks chip

#### Scenario: Same facts as the Folders row

- **WHEN** the same folder is shown in the Folders sidebar and a panel of it on the dashboard
- **THEN** both show the same pull request number, state, and checks count

#### Scenario: Activating a chip

- **WHEN** a user activates the pull request or checks chip on a dashboard card
- **THEN** the card is activated and no browser or check list opens
