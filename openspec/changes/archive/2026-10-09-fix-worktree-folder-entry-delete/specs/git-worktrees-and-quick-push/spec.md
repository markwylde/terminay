## ADDED Requirements

### Requirement: Changed paths carry their directory state

A Git change SHALL carry whether its path is a directory, including a symlink
that resolves to one, decided on the server from the filesystem. A changed
directory SHALL present as a folder in the Git tree: a folder icon, the folder
context menu, and the Folder panel on open, rather than a file row that offers a
diff.

#### Scenario: A worktree's linked dependencies directory

- **WHEN** a worktree's `node_modules` is a symlink to another checkout and Git
  reports it as untracked
- **THEN** the Git tree shows it as a folder with the folder context menu

#### Scenario: A changed file stays a file

- **WHEN** a changed path is an ordinary file
- **THEN** the row keeps the file presentation and its diff action

## MODIFIED Requirements

### Requirement: Cross-worktree mutations switch the project root first

Create, rename, and delete initiated from another listed worktree SHALL switch
the project to that worktree first and SHALL wait until the new root is
authoritative. They SHALL NOT relativize the selected path against the former
project root into a traversal request. Once the mutation settles, whether it
succeeded or failed, the project root SHALL return to the root the user was on.
Opening an entry from another worktree is navigation and SHALL leave the project
on that worktree.

#### Scenario: Creating in another worktree

- **WHEN** a user creates, renames, or deletes a file or folder from another
  listed worktree's Git tree
- **THEN** the project switches to that worktree and the mutation runs only
  after the project root change is authoritative

#### Scenario: The project root is handed back

- **WHEN** a cross-worktree create, rename, or delete settles
- **THEN** the project root returns to the root the user was on before the
  mutation, whether the mutation succeeded or failed

#### Scenario: Opening stays in the worktree

- **WHEN** a user opens an entry from another listed worktree's Git tree
- **THEN** the project stays on that worktree

#### Scenario: No path traversal

- **WHEN** a cross-worktree mutation is prepared
- **THEN** the selected path is not relativized against the former project root
  into a traversal request
