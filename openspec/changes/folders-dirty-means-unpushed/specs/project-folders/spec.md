## MODIFIED Requirements

### Requirement: Linked folder presentation

A linked folder's card SHALL show the branch of its worktree on its branch line. General SHALL show the branch of the project root checkout in the same place. A plain folder SHALL show neither a branch line nor a facts line.

A checkout is dirty when it holds work that exists only on this machine: uncommitted or untracked changes, or unpushed commits. A checkout is unmerged when it holds commits whose effect the default branch does not have, whether or not they are pushed. The two are independent. The branch of a dirty checkout SHALL be drawn in the accent colour; the branch of any other checkout SHALL be drawn in the ordinary text colour. The branch line of an unmerged checkout SHALL end with an upward arrow and the number of commits the default branch lacks, or the arrow alone when that number is not measured. The arrow and number SHALL keep a muted colour whether or not the checkout is dirty, SHALL NOT be truncated when the branch name is, and SHALL give their meaning as an accessible name and a tooltip. A checkout that is not unmerged SHALL show no arrow.

The facts line SHALL show, in this order and each as its own chip: the size of the checkout's unpushed work when it is dirty, as lines added and lines removed, or the word `changed` when the size is not measured; the word `missing` when a linked folder's worktree is not on disk; nothing for a checkout that is not dirty; the pull request published for a linked folder's worktree, as `PR #` and its number, followed by its state when that state is not open; `no PR` when a linked folder is dirty or unmerged and has no pull request; and the check state published for a linked folder's worktree, as an indicator, a count, and a word for what is counted. General SHALL show its change size chip and no pull request or checks chip. A folder with none of these SHALL show no facts line.

The facts line SHALL NOT wrap. Where the column is too narrow to show every chip in full, the pull request chip SHALL drop its `PR` prefix and the checks chip SHALL drop its word, each keeping its number. A chip SHALL NOT be truncated in the middle of its text. The full text of a shortened chip SHALL remain available as its accessible name and its tooltip. Choosing the pull request chip SHALL open the pull request, and choosing the checks chip SHALL show that folder's checks beneath its facts line, wherever those actions are available.

#### Scenario: Pushed branch with a pull request

- **WHEN** a linked folder's worktree is on `feat/one-project-one-window`, every one of its four commits is pushed, nothing is uncommitted, the default branch lacks those commits, and it has pull request 350 with 23 checks running
- **THEN** its branch line shows that branch in the ordinary text colour followed by `↑4`, and its facts line shows `PR #350` and a running indicator with `23 running`, with no change size chip

#### Scenario: Unpushed work on a branch with a pull request

- **WHEN** that worktree then gains uncommitted and unpushed work of 12 lines added and 3 removed, of which one commit is unpushed
- **THEN** its branch line shows the branch in the accent colour followed by `↑5`, and its facts line shows `+12 −3`, `PR #350`, and the running indicator with `23 running`, on one line

#### Scenario: Worktree without a pull request

- **WHEN** a dirty linked folder's worktree has no pull request
- **THEN** its facts line shows the size of its unpushed work and `no PR`

#### Scenario: Pushed branch without a pull request

- **WHEN** a linked folder's worktree is unmerged, has nothing unpushed, and has no pull request
- **THEN** its branch is drawn in the ordinary text colour with its arrow and number, and its facts line shows `no PR` and no change size chip

#### Scenario: Uncommitted work on a merged branch

- **WHEN** a linked folder's worktree holds uncommitted changes and no commit the default branch lacks
- **THEN** its branch is drawn in the accent colour with no arrow, and its facts line shows the size of the uncommitted changes

#### Scenario: Clean worktree

- **WHEN** a linked folder's worktree holds nothing the default branch lacks, nothing unpushed, and has no pull request
- **THEN** its branch is drawn in the ordinary text colour with no arrow and its card has no facts line

#### Scenario: Clean worktree with a merged pull request

- **WHEN** a linked folder's worktree is neither dirty nor unmerged and its pull request 352 is merged
- **THEN** its branch is drawn in the ordinary text colour and its facts line shows `PR #352 merged`

#### Scenario: General on a clean default branch

- **WHEN** the project root checkout is on the default branch with no changes and nothing unpushed
- **THEN** General shows that branch in the ordinary text colour and no facts line

#### Scenario: General with changes

- **WHEN** the project root checkout holds uncommitted changes or unpushed commits
- **THEN** General shows its branch in the accent colour and a change size chip, and no pull request or checks chip

#### Scenario: Long branch name on an unmerged checkout

- **WHEN** an unmerged checkout's branch name is longer than the column is wide
- **THEN** the branch name is truncated with an ellipsis and the arrow and number are shown in full after it

#### Scenario: Narrow column

- **WHEN** the column is too narrow to show `+247 −13`, `PR #350`, and `23 running` in full
- **THEN** the facts line stays one line and shows `+247 −13`, `#350`, and the running indicator with `23`

#### Scenario: Plain folder

- **WHEN** a folder is a plain folder
- **THEN** its card shows its title line and no branch or facts line
