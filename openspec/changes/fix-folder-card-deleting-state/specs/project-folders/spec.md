## ADDED Requirements

### Requirement: A linked folder being deleted says so on its card

While the removal of a linked folder's worktree is in progress, that folder's card SHALL show the word `Deleting…` on a line of its own beneath its label, from the moment the removal is confirmed until that removal settles, whether the worktree is removed alone or as one target of a bulk deletion, and whether or not the folder is the one selected. While the line is shown the card SHALL NOT show its facts line, and the folder's row SHALL be marked busy for assistive technology. A card whose worktree is not being removed SHALL show no such line. General and a plain folder SHALL never show it. When a removal is refused or fails, the line SHALL be removed and the card SHALL show its facts line again.

#### Scenario: Deleting one worktree

- **WHEN** the user confirms Delete worktree on the linked folder `alpha` while another linked folder `beta` exists
- **THEN** the card of `alpha` shows `Deleting…` beneath its label until the removal settles, and the card of `beta` does not

#### Scenario: Facts give way

- **WHEN** a linked folder whose card shows a change size chip and a pull request chip is being deleted
- **THEN** its card shows `Deleting…` and neither chip

#### Scenario: Bulk deletion

- **WHEN** a confirmed bulk deletion of three clean worktrees is running
- **THEN** the card of each worktree not yet removed shows `Deleting…` until its own removal settles

#### Scenario: Removal refused

- **WHEN** the server refuses the removal of a linked folder's worktree
- **THEN** its card stops showing `Deleting…` and shows its facts line as before
