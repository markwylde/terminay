## MODIFIED Requirements

### Requirement: Deleting a folder that still holds panels

When a user deletes the worktree of a linked folder, or deletes a plain folder that still holds panels, Terminay SHALL show exactly one dialog before anything is deleted, with a **Cancel** button and a **Delete** button. When the folder holds panels, the dialog SHALL offer a choice of what happens to them, **Move to General** or **Close them**, with Move to General selected when the dialog opens. For a worktree, the dialog SHALL name the worktree and its path and SHALL state the worktree removal warning. When Close them is selected and any of the folder's terminals has a non-shell foreground process, the dialog SHALL state how many, and that closing stops them. Cancel, Escape, and a click outside the dialog SHALL leave the folder, its panels, and its worktree unchanged.

After the user chooses Delete, Terminay SHALL ask nothing further. Move to General SHALL move every panel to General with its terminals still running. Close them SHALL close every panel without close-protection prompts, saving any autosaving file panel first. The folder, and for a linked folder its worktree, SHALL be deleted only after the chosen outcome has been committed for every panel the dialog covered. If any panel cannot be moved or closed, or a panel the dialog did not cover is in the folder, nothing SHALL be deleted and Terminay SHALL report why as an error rather than as another question.

#### Scenario: Moving the terminals

- **WHEN** a user deletes a plain folder holding two running terminals, keeps Move to General selected, and chooses Delete
- **THEN** both terminals are in General, still running, and the folder is gone
- **AND** no other prompt was shown

#### Scenario: Closing the terminals

- **WHEN** a user deletes a worktree whose folder holds two idle terminals, selects Close them, and chooses Delete
- **THEN** both terminals are closed, the worktree is removed, and the folder is gone
- **AND** no other prompt was shown

#### Scenario: Closing a busy terminal

- **WHEN** a user deletes a worktree whose folder holds a terminal with a non-shell foreground process and selects Close them
- **THEN** the dialog states that one terminal has a running process that closing will stop
- **AND** after Delete the terminal is closed and the worktree removed without a further prompt

#### Scenario: Worktree with no panels

- **WHEN** a user deletes a worktree whose folder holds no panels
- **THEN** one dialog with the removal warning, Cancel, and Delete is shown, without a choice about panels

#### Scenario: A panel arrives during the delete

- **WHEN** a panel the dialog did not cover is in the folder once the chosen outcome has been applied
- **THEN** neither the folder nor the worktree is deleted, that panel is left as it is, and an error says why

#### Scenario: Cancel

- **WHEN** the user cancels the dialog
- **THEN** the folder, its panels, and its worktree are unchanged
