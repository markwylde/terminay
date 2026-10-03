## MODIFIED Requirements

### Requirement: Focused terminal summary

When a terminal holds focus in the active project, the left side of the status bar SHALL describe that terminal. It SHALL show, in order: a tab segment holding a miniature of the project's split layout, with the group that holds the focused terminal highlighted, followed by the focused terminal's title; the terminal's observed working directory as a breadcrumb of path segments, with the user's home directory shown as `~` and long paths collapsed from the middle so the last segments stay visible; and a branch chip naming the Git branch of the project worktree that contains that directory. The branch chip SHALL show the count of uncommitted changes when there are any and the count of commits ahead of the default branch when there are any. When the directory is not inside a known worktree of the project, the branch chip SHALL be omitted; the status bar SHALL NOT claim the directory is not a repository, because it may be one the project does not track. When the working directory has not been observed, the breadcrumb and branch chip SHALL be omitted rather than showing the spawn directory as though it were current. When the active tab is not a project, or the project has neither a focused terminal nor a focused file panel, the left side SHALL be empty.

#### Scenario: Focused terminal in a repository

- **WHEN** the focused terminal's working directory is inside a project worktree on branch `feat/auto-expose` with three uncommitted changes and two commits ahead of the default branch
- **THEN** the status bar shows the terminal's title, its directory breadcrumb, and a branch chip reading `feat/auto-expose` with the uncommitted and ahead counts

#### Scenario: Directory outside the project's worktrees

- **WHEN** the focused terminal's working directory is not inside a known worktree of the project
- **THEN** the status bar shows the breadcrumb and no branch chip

#### Scenario: Split layout miniature

- **WHEN** the project's layout has two side-by-side groups and the focused terminal is in the right-hand group
- **THEN** the miniature shows two side-by-side cells with the right-hand cell highlighted

#### Scenario: Home dashboard

- **WHEN** the Home dashboard is the active tab
- **THEN** the left side of the status bar is empty

## ADDED Requirements

### Requirement: Focused file summary

When a file panel is the active panel of the active project, the left side of the status bar SHALL describe that file instead of a terminal. It SHALL show, in order: a tab segment holding the split layout miniature, with the group that holds the file panel highlighted, followed by the panel's title; the file's folder as a breadcrumb in the same form as a terminal's working directory; a branch chip when that folder is inside a known worktree of the project; the file's size in a short human-readable form, with the exact byte count available on hover; and an unsaved marker while the panel has unsaved changes. The size SHALL be omitted until the server has described the file. The summary SHALL update when the file's size or unsaved state changes and when focus moves to another panel, without polling.

#### Scenario: Focused file

- **WHEN** a 7,844-byte file in a project worktree on branch `main` is the active panel
- **THEN** the status bar shows the file's name, its folder breadcrumb, a branch chip reading `main`, and `7.7 KB`

#### Scenario: Unsaved changes

- **WHEN** the user edits the focused file without saving
- **THEN** the status bar shows the unsaved marker
- **AND** the marker clears when the file is saved

#### Scenario: Focus returns to a terminal

- **WHEN** focus moves from a file panel to a terminal
- **THEN** the status bar describes that terminal
