## MODIFIED Requirements

### Requirement: The General folder

Every project SHALL have exactly one General folder, created with the project. General SHALL NOT be renamed or deleted. General SHALL take any place in the folder order, as any other folder does. A panel created without a folder SHALL land in General, wherever General is in the order. In a project whose root is a Git checkout, General SHALL represent that checkout.

#### Scenario: New project

- **WHEN** a project is created
- **THEN** it has one folder, General, holding the project's first terminal

#### Scenario: General cannot be removed

- **WHEN** a client requests that General be renamed or deleted
- **THEN** the server refuses the command and General is unchanged

#### Scenario: General moved down the order

- **WHEN** a client requests a folder order that places General after another folder of the project
- **THEN** the server commits that order and every device showing the project lists General in its new place

#### Scenario: A panel with no folder after General has moved

- **WHEN** General is last in a project's folder order and a panel is created in that project without naming a folder
- **THEN** the panel lands in General

### Requirement: Plain folders

A user SHALL be able to create a plain folder with a name, rename it, move it to any place in the folder order, and delete it. Deleting an empty plain folder SHALL remove it at once. The server SHALL refuse a name a user gives a folder when another folder of the project already has it, comparing without regard to letter case. A linked folder SHALL take its worktree directory's name whatever else has that name.

#### Scenario: Creating a folder

- **WHEN** a user chooses New folder and names it
- **THEN** an empty plain folder with that name is added to the end of the project's folders on every connected device

#### Scenario: A name already in use

- **WHEN** a user names a new folder General, or renames a folder to the name of another folder of the project
- **THEN** the server refuses, no folder is created or renamed, and the user is told the name is taken

#### Scenario: Deleting an empty folder

- **WHEN** a user deletes a plain folder that holds no panels
- **THEN** the folder is gone and nothing is asked

### Requirement: Reordering folders from the tree

Every folder card SHALL show a drag grip at the left of its title line, General included. Dragging a card by its grip SHALL move it among the project's other folders, to any place in the order, and releasing it SHALL ask the server to commit the new order; the tree SHALL present the order the server committed. The grip SHALL be reachable from the keyboard, where the up and down arrow keys SHALL move the focused folder one place and SHALL do nothing at the end of the order they point to. Dragging a grip SHALL NOT select a folder, start a terminal move, or open a menu. A tree that only lists, such as a tab peek, SHALL show no grip.

While a card is dragged it SHALL be drawn lifted above the other cards and SHALL follow the pointer along the vertical axis only, never moving sideways. The other cards SHALL slide to open the place the dragged card would take if released, and on release the card SHALL settle into that place. Where the device asks for reduced motion, the cards SHALL take their new places without animation.

#### Scenario: Dragging a folder up

- **WHEN** a project lists General, alpha, and beta, and a user drags beta's grip above alpha and releases
- **THEN** the tree lists General, beta, alpha, and every other device showing the project lists the same order

#### Scenario: Dragging a folder above General

- **WHEN** a project lists General, alpha, and beta, and a user drags beta's grip above General and releases
- **THEN** the tree lists beta, General, alpha, and every other device showing the project lists the same order

#### Scenario: Dragging General

- **WHEN** a project lists General, alpha, and beta, and a user drags General's grip below beta and releases
- **THEN** the tree lists alpha, beta, General, and a reload shows the same order

#### Scenario: Keyboard reorder

- **WHEN** beta is last of three folders, its grip has focus, and the user presses the up arrow twice and then once more
- **THEN** beta is first after the second press, the third press changes nothing, and the grip keeps focus throughout

#### Scenario: Every card has a grip

- **WHEN** the Folders tree of a project holding General, a plain folder, and a linked folder is shown
- **THEN** each of the three cards has a drag grip on its title line

#### Scenario: The card follows the pointer vertically

- **WHEN** a user presses a card's grip and moves the pointer down and to the right
- **THEN** the card moves down with the pointer, its horizontal position does not change, and the card it passes slides up into the place it left

#### Scenario: Reduced motion

- **WHEN** the device asks for reduced motion and a user drags a card to a new place and releases
- **THEN** the cards are in the new order with no sliding or settling animation
