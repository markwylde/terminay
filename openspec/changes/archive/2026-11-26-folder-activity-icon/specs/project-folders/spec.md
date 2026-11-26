## MODIFIED Requirements

### Requirement: Linked folder details tooltip

A linked folder's card SHALL show a details tooltip when the pointer has rested on its title line for one second, and when keyboard focus has rested on the card for one second. The pointer resting on the folder's activity icon, or on a control on the title line, SHALL NOT count as resting on the title line: moving onto the activity icon SHALL cancel a pending details tooltip and close a shown one, and the activity icon SHALL show its own tooltip instead. The tooltip SHALL NOT appear sooner. It SHALL show three labelled lines in this order: `Branch`, the branch of the worktree, or `detached at` and the short commit when the worktree has no branch; `Worktree`, the name of the worktree's directory; and `Location`, the worktree's path as the server reports it. Each line SHALL be a single unwrapped line. A location too long for the tooltip SHALL be truncated at its start with an ellipsis, so that the end of the path is shown; a branch or worktree name too long SHALL be truncated at its end.

The tooltip SHALL close when the pointer leaves the title line, when focus leaves the card, on Escape, on a press, when the tree scrolls, when a drag starts, and when the folder's menu opens, and a pending tooltip SHALL be cancelled by any of these. The tooltip SHALL NOT receive pointer input, SHALL NOT be clipped by the Folders column, and SHALL stay inside the window. Its content SHALL be exposed to assistive technology as the card's description. General and plain folders SHALL show no details tooltip.

#### Scenario: Resting on a worktree

- **WHEN** the pointer rests for one second on the title line of a linked folder whose worktree is on `feat/reorder-rows` in `/Users/mark/Projects/terminay/.claude/worktrees/reorder-rows`
- **THEN** a tooltip shows `Branch` `feat/reorder-rows`, `Worktree` `reorder-rows`, and `Location` with that path, on three lines

#### Scenario: Passing over a worktree

- **WHEN** the pointer crosses a linked folder's title line and leaves it within one second
- **THEN** no tooltip is shown

#### Scenario: Long location

- **WHEN** the tooltip is shown for a worktree whose path is wider than the tooltip
- **THEN** the location is one line that begins with an ellipsis and ends with the worktree's directory name

#### Scenario: Detached worktree

- **WHEN** the tooltip is shown for a worktree on a detached HEAD at commit `16be2864`
- **THEN** its first line shows `Branch` `detached at 16be2864`

#### Scenario: Keyboard focus

- **WHEN** keyboard focus rests on a linked folder's card for one second
- **THEN** the tooltip is shown, and pressing Escape closes it

#### Scenario: Opening the menu

- **WHEN** a user opens a linked folder's menu while its tooltip is shown or pending
- **THEN** the tooltip is not shown beside the menu

#### Scenario: General

- **WHEN** the pointer rests on General's title line for one second
- **THEN** no details tooltip is shown

#### Scenario: Resting on the activity icon

- **WHEN** a linked folder is being pulled and the pointer moves from its label onto its pull icon while the details tooltip is pending or shown, and rests there
- **THEN** the details tooltip is cancelled or closed, and the icon's tooltip `Pulling from origin…` is shown in its place

### Requirement: The Folders tree

A project SHALL present a Folders tree in a column to the left of its panel area. The tree SHALL list the project's folders in order, each as a block that spans the full width of the column, with no side margin and no rounded corners. Consecutive blocks SHALL be separated by a narrow gutter drawn in the column's background, so that each folder reads as one group.

A block SHALL hold, in this order: a header band; that folder's panel rows; then a New terminal row. The header band SHALL be drawn in a lighter tone than the folder's rows and SHALL hold its title line, then a branch line when the folder is General and has a checkout to name, then a facts line when the folder has facts to show. The title line SHALL begin with the folder's collapse control and SHALL hold no other control before the folder's name. The title line of General and of a plain folder SHALL then hold the folder icon and the folder's name. The title line of a linked folder SHALL then hold the branch icon, the folder's label, and its unmerged mark when it has one, and a linked folder's block SHALL have no branch line. While a pull or a deletion of the folder's worktree is in progress, that folder's activity icon SHALL stand in the place of its folder icon or branch icon, at the same size. Showing, changing, or removing the activity icon SHALL NOT add, remove, or resize any line of the header band; the branch line and facts line follow the checkout's state as they do at any other time. The name or label SHALL be drawn in small uppercase semibold type, in the style of the right sidebar's pane titles, while its accessible name and tooltip keep the text's own case. The title line SHALL end with a pill counting the panels the folder holds, then the folder's menu button.

The branch line and the facts line SHALL start at the leading edge of the header band's content, under the collapse control, with no further indent. Each panel row SHALL be set in so that its status indicator, or the icon that stands in its place, sits under the collapse control.

Every line and row SHALL be a single unwrapped line, and a name, label, branch, or title too long for the column SHALL be truncated with an ellipsis. The folder that holds the focused panel SHALL be exposed as selected, and the focused panel's row SHALL be highlighted as active. A terminal's row SHALL offer the same context menu as that terminal's tab, acting on that terminal, whichever folder is selected. The selected folder's header band SHALL be tinted with the project colour, and its block SHALL NOT be outlined or striped. The tree SHALL offer New folder. The column's header SHALL use the project chrome so the colour band continues across the tree, the panel tab strip, and the sidebar.

#### Scenario: Reading the tree

- **WHEN** a project has General with one terminal and a linked folder with two
- **THEN** the tree shows a block for General with its header band, its terminal, and a New terminal row, then a gutter, then a block for the linked folder with its header band, its two terminals, and a New terminal row

#### Scenario: Blocks span the column

- **WHEN** the tree shows two folders
- **THEN** each folder's block reaches both edges of the column, has square corners, and is separated from the next by a gutter in the column's background

#### Scenario: Lines of a linked folder's block

- **WHEN** a linked folder's worktree is on `feat/reorder-rows` and is dirty with no pull request
- **THEN** its header band shows one title line holding the collapse control, the branch icon, `FEAT/REORDER-ROWS`, a panel count, and the menu button, then its facts line, with no folder icon and no second line naming the branch
- **AND** the label's accessible name is `feat/reorder-rows`

#### Scenario: Lines of General's block

- **WHEN** the project root checkout is on `main`
- **THEN** General's header band shows a title line holding the collapse control, the folder icon, `GENERAL`, a panel count, and the menu button, then a branch line showing `main`

#### Scenario: Panel count

- **WHEN** a folder holds two terminals and one open file
- **THEN** its title line's count pill shows `3`

#### Scenario: Lines start under the chevron

- **WHEN** a linked folder shows a facts line and holds a terminal
- **THEN** the facts line's first chip starts at the same horizontal position as the collapse control, and the terminal's status indicator sits under the collapse control

#### Scenario: Selecting a terminal

- **WHEN** a user selects a terminal row in another folder
- **THEN** that folder becomes the selected folder, its layout is presented, that terminal is focused, and its row is the one highlighted

#### Scenario: A terminal row's menu

- **WHEN** a user opens the context menu on a terminal's row
- **THEN** it offers what the context menu of that terminal's tab offers, and choosing Close closes that terminal

#### Scenario: A terminal row's menu in another folder

- **WHEN** a user opens the context menu on the row of a terminal in a folder that is not the selected one
- **THEN** the menu is that terminal's, and acts on it

#### Scenario: Selecting a folder

- **WHEN** a user selects a folder by its title, branch, or facts line, outside any control on them
- **THEN** that folder's layout is presented with the panel that was last active in it focused

#### Scenario: The selected folder

- **WHEN** the focused terminal is in a folder
- **THEN** that terminal's row is highlighted, that folder's header band is tinted, and no other header band is tinted

#### Scenario: Selected folder with no panels

- **WHEN** a user selects a folder that holds no panels
- **THEN** that folder's header band is tinted and no row in the tree is highlighted

#### Scenario: Empty folder

- **WHEN** a folder holds no panels
- **THEN** its block shows its header band followed directly by the New terminal row, with no placeholder text

#### Scenario: Long titles

- **WHEN** a terminal title, a branch name, or a linked folder's label is longer than the tree is wide
- **THEN** the line stays one line and the text is truncated with an ellipsis

#### Scenario: Git activity moves nothing

- **WHEN** General shows a title line and a branch line and no facts line, and a pull of its worktree that changes none of its facts starts and then settles
- **THEN** General's header band keeps the same height throughout, and every row and folder beneath it stays where it was

#### Scenario: Facts that change during the activity

- **WHEN** a pull of a linked folder's worktree is in progress and the folder's facts change, for example its change size chip goes away
- **THEN** its facts line follows the new facts as it would without the pull, and the pull icon stays in the place of its branch icon

## ADDED Requirements

### Requirement: A linked folder being deleted shows it on its title line

While the removal of a linked folder's worktree is in progress, from the moment the removal is confirmed until it settles, whether the worktree is removed alone or as one target of a bulk deletion, and whether or not the folder is the one selected, that folder's title line SHALL show an animated trash icon in the place of its branch icon. The icon SHALL carry the tooltip and the accessible status `Deleting worktree…`, and the folder's row SHALL be marked busy for assistive technology. The card SHALL NOT gain or lose a line: its facts line, when it has one, stays shown. While the icon is shown the whole card, its head, its terminal rows, and its New terminal row together, SHALL be drawn at 40% opacity. A card whose worktree is not being removed SHALL show no such icon and SHALL be drawn at full opacity. General and a plain folder SHALL never show it. Under a reduced-motion preference the icon SHALL NOT move. When a removal is refused or fails, the branch icon SHALL return and the card SHALL be drawn at full opacity.

#### Scenario: Deleting one worktree

- **WHEN** the user confirms Delete worktree on the linked folder `alpha` while another linked folder `beta` exists
- **THEN** the title line of `alpha` shows the trash icon, labelled `Deleting worktree…`, in place of its branch icon until the removal settles, and the card of `beta` keeps its branch icon

#### Scenario: The whole card is dimmed

- **WHEN** a linked folder that holds two terminals is being deleted
- **THEN** its label, the trash icon, both terminal rows, and its New terminal row are drawn at 40% opacity, and every other card is drawn at full opacity

#### Scenario: Facts stay put

- **WHEN** a linked folder whose card shows a change size chip and a pull request chip is being deleted
- **THEN** its card still shows both chips on its facts line, and its header band keeps its height

#### Scenario: Bulk deletion

- **WHEN** a confirmed bulk deletion of three clean worktrees is running
- **THEN** the title line of each worktree not yet removed shows the trash icon until its own removal settles

#### Scenario: Removal refused

- **WHEN** the server refuses the removal of a linked folder's worktree
- **THEN** its title line shows its branch icon again and its card returns to full opacity

#### Scenario: Reduced motion while deleting

- **WHEN** the device asks for reduced motion and a linked folder is being deleted
- **THEN** its trash icon is shown and does not move

### Requirement: A folder being pulled shows it on its title line

While a pull from origin of a folder's worktree is in progress, from the moment the pull is requested until it settles, whether the folder is General or a linked folder and whether or not it is the one selected, that folder's title line SHALL show an animated pull icon, an arrow dropping into a line, in the place of its folder icon or branch icon. The icon SHALL carry the tooltip and the accessible status `Pulling from origin…`, the folder's row SHALL be marked busy for assistive technology, and, unless the worktree is also being deleted, the card SHALL be drawn at full opacity. The card SHALL NOT gain or lose a line: its branch line and facts line, when it has them, stay shown. A card whose worktree is not being pulled SHALL show no such icon, and a plain folder SHALL never show it. When the card's worktree is also being deleted, the card SHALL show the trash icon and not the pull icon, and SHALL be drawn as the deletion requirement says. Under a reduced-motion preference the icon SHALL NOT move. When the pull settles, applied, refused, or failed, the folder icon or branch icon SHALL return, unless a deletion of the worktree is still in progress, in which case the trash icon stays.

#### Scenario: Pulling a linked folder

- **WHEN** the user chooses Pull from origin on the linked folder `alpha` while another linked folder `beta` exists
- **THEN** the title line of `alpha` shows the pull icon, labelled `Pulling from origin…`, in place of its branch icon until the pull settles, and the card of `beta` keeps its branch icon

#### Scenario: Pulling General

- **WHEN** the user chooses Pull from origin on General in a Git project
- **THEN** General's title line shows the pull icon in place of its folder icon until the pull settles, and no line is added beneath its branch line

#### Scenario: Facts stay put, the card stays bright

- **WHEN** a linked folder whose card shows a change size chip is being pulled
- **THEN** its card still shows the chip, keeps its height, and is drawn at full opacity

#### Scenario: Pull fails

- **WHEN** the server refuses the pull of a folder's worktree
- **THEN** its title line shows its folder icon or branch icon again

#### Scenario: Pulled and deleted at once

- **WHEN** a linked folder's worktree is being pulled and is then also being deleted, and the pull settles before the removal
- **THEN** its title line shows the trash icon and its card is drawn at 40% opacity from the moment the removal is confirmed until the removal settles, and the pull icon is not shown again

#### Scenario: Reduced motion while pulling

- **WHEN** the device asks for reduced motion and a folder is being pulled
- **THEN** its pull icon is shown and does not move

## REMOVED Requirements

### Requirement: A linked folder being deleted says so on its card

**Reason**: Its `Deleting…` line beneath the label added a row to the card and hid the facts line, moving everything beneath it (issue #662).
**Migration**: Replaced by "A linked folder being deleted shows it on its title line", which shows an animated trash icon in place of the branch icon and keeps the card's lines.

### Requirement: A folder being pulled says so on its card

**Reason**: Its `Pulling…` line beneath the label added a row to General's card and hid a linked folder's facts line, moving everything beneath it (issue #662).
**Migration**: Replaced by "A folder being pulled shows it on its title line", which shows an animated pull icon in place of the folder or branch icon and keeps the card's lines.
