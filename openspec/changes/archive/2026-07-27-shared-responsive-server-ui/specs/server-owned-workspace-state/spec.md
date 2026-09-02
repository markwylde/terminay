## ADDED Requirements

### Requirement: Responsive rendering of one model

Wide desktop clients SHALL render the full Dockview workspace. Narrow clients SHALL adapt the same project and panel model into selectors, stacked or tabbed surfaces, drawers, and touch controls without creating a second workspace model.

#### Scenario: Narrow client

- **WHEN** a client is too narrow for the full workspace
- **THEN** it presents the same project and panel model through selectors, stacked surfaces, drawers, and touch controls

### Requirement: Server-owned project and terminal lifecycle from any client

Project and terminal creation, selection, and close SHALL be server-owned for every connected client, including browsers. Creating a project SHALL issue one canonical create command and reconcile the returned server id, name, and root into the client's tab strip rather than synthesising a local project or an empty root. Creating a terminal SHALL produce exactly one server-owned session in the active canonical project, attach it once, and select its panel. Closing a project SHALL close its panels and tabs, terminate its project-owned terminal sessions, remove those session records from the workspace snapshot, delete the project, and select the next remaining project. Closing a terminal, file, or folder panel SHALL use the canonical close command against the real server panel id, not a synthetic local id. Created and closed state SHALL survive refresh and reconnect without duplicated, empty, or resurrected tabs.

#### Scenario: Browser project creation is canonical

- **WHEN** a browser client creates a project
- **THEN** exactly one project is created through the canonical command and its server id, name, and root are reconciled into the tab strip

#### Scenario: Project close cascades

- **WHEN** a project with open terminals is closed
- **THEN** its panels close, its terminal sessions terminate and leave the snapshot, the project is deleted, and the next remaining project is selected

#### Scenario: Closed panel does not return

- **WHEN** a closed panel's client refreshes or reconnects
- **THEN** the closed panel is not resurrected

### Requirement: Command-first terminal panel close

Closing a canonical terminal panel SHALL be command-first: the renderer SHALL wait for the server close result and a reconciled snapshot before completing the UI action. Panel removal SHALL be a projection of that confirmed state and SHALL NOT launch a second close command from a stale revision.

#### Scenario: Closing a busy terminal panel

- **WHEN** the user closes a terminal panel whose PTY is busy
- **THEN** the renderer waits for the server close result and reconciled snapshot before removing the panel

#### Scenario: No duplicate close command

- **WHEN** the projection removes a closed terminal panel
- **THEN** no second close command is issued from a stale revision

### Requirement: Bounded workspace refresh and file observation

A connected client SHALL keep its workspace current through a single-flight snapshot and delta lifecycle over the authenticated connection. It SHALL reject stale, malformed, or structurally cross-owned state and reconcile its local view, project, and panel selection to the authoritative graph, including file-only and folder-only projects. An idle connected workspace SHALL rely on change subscriptions and server-registered file watches rather than sidebar or full-snapshot polling; a failed watch registration SHALL perform one bounded folder refresh instead of surfacing a global error or retrying repeatedly. Transient refresh failures SHALL preserve the last good Git and worktree projection, identical projections SHALL NOT trigger repaint, and Git state SHALL clear only on a real project or root switch. Sidebar interaction SHALL keep refreshes bounded and SHALL NOT leave terminal protocol requests pending.

#### Scenario: Idle workspace makes no requests

- **WHEN** a connected workspace sits idle with its sidebar visible
- **THEN** it issues no polling protocol requests and its rendered sidebar state does not change

#### Scenario: Failed watch registration is bounded

- **WHEN** a server file-watch registration fails
- **THEN** one bounded folder refresh is performed and no global error or retry storm is produced

#### Scenario: Transient Git failure keeps the last projection

- **WHEN** a Git or workspace refresh fails transiently
- **THEN** the last good Git and worktree projection is retained rather than cleared

### Requirement: Project root follows the canonical server-owned root

Setting a project root from the active terminal's working directory SHALL query the exact server-owned terminal working directory, persist that value as the canonical project root, and rebind the server file and Git services to it. Explorer, Git, and workspace projections SHALL refresh to that root without stale root presentation, and terminal attachment and input SHALL be preserved across the change. Where the server Git projection reports an empty or non-repository state for an inspectable folder, the client SHALL render a stable empty Git projection rather than an indefinite loading state.

#### Scenario: Root follows the terminal working directory

- **WHEN** the user sets the project root to the active terminal's working directory after changing directory
- **THEN** the canonical project root becomes that exact directory and Explorer and Git refresh to it

#### Scenario: Non-repository root renders a stable empty state

- **WHEN** the canonical project root is not a repository
- **THEN** a stable empty Git projection is rendered instead of an indefinite loading state
