## MODIFIED Requirements

### Requirement: Folders on a compact workspace

On a compact workspace the Folders tree SHALL NOT be presented as a column. The unified switcher's folder tree SHALL list each project's folders, with each folder's panels beneath it, so that a panel in any folder is reachable from the switcher. Each folder in the switcher SHALL offer the same folder context-menu actions as the Folders tree and a new terminal for the default shell and for each available terminal launcher, so that every folder context-menu action and every launcher reachable on a wide window is reachable at phone width for a project on the window's current server.

#### Scenario: Phone width

- **WHEN** a project with General and one linked folder is shown at phone width
- **THEN** no Folders column is present, and the switcher lists both folders with their terminals

#### Scenario: Deleting a worktree at phone width

- **WHEN** a user opens a linked folder's ⋯ menu in the switcher and chooses Delete worktree
- **THEN** the same confirmation and deletion run as from the Folders tree's context menu
