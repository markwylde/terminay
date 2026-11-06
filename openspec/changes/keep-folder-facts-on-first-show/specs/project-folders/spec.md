## ADDED Requirements

### Requirement: A folder shown for the first time keeps the tree's git facts

A window SHALL draw a folder it shows for the first time from the last worktree listing it holds for that project and the project's own root, until that folder's own listing arrives. This applies to the folder's Folders tree, its Changes pane and the Git badges in its Files pane. While that first listing is outstanding, no card SHALL lose its facts line or the branch in its label for that reason. Every other rule for drawing a card still holds.

#### Scenario: A terminal that creates a worktree is moved into its new folder

- **WHEN** an open linked folder `alpha` shows `+2` and `no PR` on its facts line, and a terminal in General runs `git worktree add ../gamma-tree -b gamma`, which moves the terminal into the new folder `gamma` and brings `gamma` to the front
- **THEN** at every moment until `gamma`'s own listing arrives, `alpha`'s card shows its label `alpha` and a facts line with `+2` and `no PR`

#### Scenario: A folder is selected for the first time

- **WHEN** an open linked folder `alpha` shows its facts line and the user selects the linked folder `beta`, which the window has not shown before
- **THEN** at every moment while `beta` comes to the front, `alpha`'s card shows its label and its facts line

#### Scenario: The folder's own listing replaces the one it started from

- **WHEN** a folder shown for the first time started from a held listing, and its own listing arrives with different facts
- **THEN** its cards show the facts of its own listing

### Requirement: A held listing stays within its project and root

A window SHALL hold at most one worktree listing per project, for the root the project had when the listing was taken. A window SHALL NOT draw a listing for another project, or for the same project once that project's root has changed.

#### Scenario: A listing is never drawn for another project

- **WHEN** a window holds a listing for project A, holds none for project B, and shows a folder of project B for the first time
- **THEN** project B's tree shows nothing from project A's listing, and draws as it does before any listing has arrived until its own listing arrives

#### Scenario: Each project starts from its own listing

- **WHEN** a window holds a listing for project A and one for project B, and shows a folder of project B for the first time
- **THEN** that folder starts from project B's listing

#### Scenario: A listing from an earlier root is not drawn

- **WHEN** a project's root changes from one checkout to another and back, and a folder of the project is then shown for the first time
- **THEN** it does not start from a listing taken while the project had the other root

### Requirement: A folder's own listing settles what it started from

When the first listing of a folder shown for the first time fails, the folder SHALL keep drawing the listing it started from, and SHALL report the failure as it reports any failed Git refresh. When that listing arrives and says the root has no repository or no worktrees, it SHALL replace the held listing.

#### Scenario: A failed first listing keeps what was shown

- **WHEN** a folder shown for the first time started from a held listing and its first listing request fails
- **THEN** its cards keep the facts they showed, and the Git failure is reported

#### Scenario: An empty listing replaces what was shown

- **WHEN** a folder shown for the first time started from a held listing, and its own listing arrives with no worktrees
- **THEN** its cards show no facts from the held listing, and the window holds the empty listing for the project
