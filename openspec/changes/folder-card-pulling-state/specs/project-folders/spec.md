## ADDED Requirements

### Requirement: A folder being pulled says so on its card

While a pull from origin of a folder's worktree is in progress, that folder's card SHALL show a spinning indicator and the word `Pulling…` on a line of its own beneath its label, from the moment the pull is requested until it settles, whether the folder is General or a linked folder and whether or not it is the one selected. While the line is shown the card SHALL NOT show its facts line, the folder's row SHALL be marked busy for assistive technology, and the card SHALL be drawn at full opacity. A card whose worktree is not being pulled SHALL show no such line, and a plain folder SHALL never show it. When the card's worktree is also being deleted, the card SHALL show `Deleting…` and not `Pulling…`. Under a reduced-motion preference the indicator SHALL NOT spin. When the pull settles, applied, refused, or failed, the line SHALL be removed and the card SHALL show its facts line again.

#### Scenario: Pulling a linked folder

- **WHEN** the user chooses Pull from origin on the linked folder `alpha` while another linked folder `beta` exists
- **THEN** the card of `alpha` shows a spinner and `Pulling…` beneath its label until the pull settles, and the card of `beta` does not

#### Scenario: Pulling General

- **WHEN** the user chooses Pull from origin on General in a Git project
- **THEN** General's card shows a spinner and `Pulling…` beneath its branch until the pull settles

#### Scenario: Facts give way, the card stays bright

- **WHEN** a linked folder whose card shows a change size chip is being pulled
- **THEN** its card shows `Pulling…` and no chip, and is drawn at full opacity

#### Scenario: Pull fails

- **WHEN** the server refuses the pull of a folder's worktree
- **THEN** its card stops showing `Pulling…` and shows its facts line as before
