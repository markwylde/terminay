## MODIFIED Requirements

### Requirement: Folder changes are named workspace commands

Creating, renaming, reordering, and deleting a folder, moving a panel between
folders, and accepting or declining a capture offer SHALL each be a named
workspace command validated and committed by the server under the same revision,
idempotency, and conflict rules as every other workspace command. A command
SHALL be refused when it names a folder outside its project, would leave a panel
without a folder, would rename or delete General, or would delete a linked
folder whose worktree exists. A reorder SHALL be refused unless it names every
folder of the project exactly once, and SHALL be accepted for any such order,
whichever folder it places first. Folders the server creates or removes to
follow the repository's worktrees, and moves it makes to capture a terminal,
SHALL be committed through the same commands and published as ordinary revisions.

#### Scenario: Deleting General

- **WHEN** a client submits a command that deletes a project's General folder
- **THEN** the server refuses it and the workspace revision is unchanged

#### Scenario: Reordering General

- **WHEN** a client submits a reorder that names every folder of a project once and places General last
- **THEN** the server commits it as one revision and every connected client receives that order

#### Scenario: Reorder that is not the project's folders

- **WHEN** a client submits a reorder that omits a folder of the project, repeats one, or names a folder of another project
- **THEN** the server refuses it and the workspace revision is unchanged

#### Scenario: Server-made folder

- **WHEN** the server creates a linked folder for a newly observed worktree
- **THEN** every connected client receives it as an ordinary workspace revision

#### Scenario: Two devices move the same panel

- **WHEN** two devices submit conflicting folder moves for one panel
- **THEN** one commits, the other is resolved by the ordinary conflict rules, and
  both devices converge on the same folder
