# workspace-status-bar Specification

## Purpose
The workspace status bar is the quiet strip along the bottom of a workspace window. It tells the user, at a glance, where the focused terminal is — its split, title, working directory and branch — and whether other devices are connected to the active server.

## Requirements

### Requirement: Workspace status bar placement and appearance

A workspace window SHALL show one status bar along its bottom edge, below the workspace content and spanning the full window width. It SHALL be tinted with the active tab's project colour, the same colour that runs through the joined chrome band, and SHALL follow that colour when the active project tab changes. On the Home dashboard it SHALL use the Home chrome colour. The status bar SHALL NOT be shown in the compact chrome layout.

#### Scenario: Status bar follows the project colour

- **WHEN** the user switches from one project tab to another project tab with a different colour
- **THEN** the status bar takes the newly active project's colour

#### Scenario: Compact chrome

- **WHEN** the workspace renders in the compact chrome layout
- **THEN** no status bar is shown

### Requirement: Focused terminal summary

The left side of the status bar SHALL describe the focused terminal of the active project. It SHALL show, in order: a tab segment holding a miniature of the project's split layout, with the group that holds the focused terminal highlighted, followed by the focused terminal's title; the terminal's observed working directory as a breadcrumb of path segments, with the user's home directory shown as `~` and long paths collapsed from the middle so the last segments stay visible; and a branch chip naming the Git branch of the project worktree that contains that directory. The branch chip SHALL show the count of uncommitted changes when there are any and the count of commits ahead of the default branch when there are any. When the directory is not inside a known worktree of the project, the branch chip SHALL be omitted; the status bar SHALL NOT claim the directory is not a repository, because it may be one the project does not track. When the working directory has not been observed, the breadcrumb and branch chip SHALL be omitted rather than showing the spawn directory as though it were current. When the active tab is not a project, or the project has no focused terminal, the left side SHALL be empty.

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

### Requirement: Status bar follows focus

The status bar SHALL update when terminal focus moves between tabs, split groups, or projects, and SHALL refresh the working directory and branch while the same terminal stays focused so that a `cd` or branch switch is reflected without changing focus. When focus moves between terminals whose working directories share leading path segments, only the segments that differ SHALL animate in; the shared segments SHALL stay in place. Animation SHALL be suppressed when the user prefers reduced motion.

#### Scenario: Moving focus between nested directories

- **WHEN** focus moves from a terminal in `~/Projects/terminay/terminay` to a terminal in `~/Projects/terminay/terminay/apps/web`
- **THEN** the shared segments stay in place and only `apps` and `web` animate in

#### Scenario: Directory change in the focused terminal

- **WHEN** the user runs `cd` in the focused terminal
- **THEN** the breadcrumb and branch chip update without the user changing focus

### Requirement: Remote access indicator

The right side of the status bar SHALL show the remote access state of the active tab's server. It SHALL show a status dot that is red when the server is the Desktop Local server and it is not exposed, grey when there are no active remote connections, and blue when at least one remote connection is active. A server that is not the Desktop Local server SHALL never show the red state. While connections are active it SHALL also show one device icon per connection, up to a small fixed maximum, and a count label such as `2 devices`. With no connections, the Desktop Local server's indicator SHALL show the dot alone with no text label, and any other server's indicator SHALL show a short `No devices` label. It SHALL NOT repeat the server name, which the header connections control already shows. Activating the indicator SHALL open the connection menu, and it SHALL carry an accessible name and tooltip that state the exposure state and the connection count.

#### Scenario: Local server not exposed

- **WHEN** the active tab's server is the Desktop Local server and it is not exposed
- **THEN** the dot is red, no device icons are shown, and no text label is shown

#### Scenario: Exposed with no connections

- **WHEN** the active tab's server is exposed and has no active remote connections
- **THEN** the dot is grey and no device icons are shown

#### Scenario: Devices connected

- **WHEN** two remote devices are connected to the active tab's server
- **THEN** the dot is blue and the indicator shows two device icons and `2 devices`

#### Scenario: Indicator opens the connection menu

- **WHEN** the user activates the remote access indicator
- **THEN** the connection menu opens

### Requirement: Status bar visibility preference

Whether the status bar is shown SHALL be a device-local preference that defaults to shown and persists across restarts. The **Show Status Bar** command SHALL toggle it. Hiding the status bar SHALL give its height back to the workspace content.

#### Scenario: Default

- **WHEN** a user opens Terminay on a device with no saved preference
- **THEN** the status bar is shown

#### Scenario: Hidden preference persists

- **WHEN** a user hides the status bar and restarts Terminay
- **THEN** the status bar remains hidden
