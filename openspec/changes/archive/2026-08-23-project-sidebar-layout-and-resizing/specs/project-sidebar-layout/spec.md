## ADDED Requirements

### Requirement: Sidebar stack occupies available height without outer scrolling
The sidebar stack SHALL fill the available height and SHALL NOT scroll vertically as a whole.
Each pane body SHALL scroll independently when its content overflows.

#### Scenario: Overflowing pane
- **WHEN** a pane's content exceeds its allocated body height
- **THEN** that pane body scrolls internally and the outer stack has no vertical scroll range

### Requirement: Pane titles always visible
Every visible pane title SHALL remain completely on screen at every supported window height and
through every supported layout interaction. The solver SHALL reserve the complete title budget
before distributing any remaining pixels.

#### Scenario: Constrained container
- **WHEN** the container is too short to give every expanded pane a body
- **THEN** every visible title is still fully rendered and body allocations shrink toward zero

### Requirement: Collapsed pane height and title minimum
The hard minimum for a visible pane SHALL be its measured title height. A collapsed pane SHALL
receive no body allocation.

#### Scenario: Collapsed pane allocation
- **WHEN** a pane is collapsed
- **THEN** it occupies exactly its measured title height

### Requirement: Space distribution among expanded panes
One pure solver SHALL normalize the whole stack, producing finite, non-negative pixel allocations
whose sum equals the container height. It SHALL handle resize, restore, collapse, expansion,
reorder, pane registration changes, and container changes without recursive per-split constraints,
and SHALL be idempotent.

#### Scenario: Deterministic and idempotent
- **WHEN** the solver runs repeatedly on an unchanged input
- **THEN** the allocations are identical and do not drift by pixels

#### Scenario: Last pane honours its preference
- **WHEN** the stack has spare height
- **THEN** the final pane honours its own preferred size rather than absorbing all remaining space

### Requirement: Resize separator presentation
Separators SHALL be rendered in an absolute overlay centred on the top edge of each non-first
visible pane title. They SHALL consume no layout pixels, SHALL present a compact visual rule with
a reliable hit target that does not obstruct title controls, and SHALL show directional minimum
and maximum states.

#### Scenario: Separator geometry
- **WHEN** the sidebar is rendered
- **THEN** each separator is centred on the top edge of the following pane title and adds no layout height

#### Scenario: Exhausted direction
- **WHEN** a separator cannot move further in one direction
- **THEN** it presents that directional limit rather than appearing freely movable

### Requirement: Continuous clamped drag preview
Starting a drag SHALL snapshot the rendered allocations. Movement SHALL distribute the delta
across the eligible panes on each side of the separator according to their available grow and
shrink capacity, and SHALL NOT mutate canonical state. Cancellation SHALL restore the snapshot.

#### Scenario: Repeated bidirectional drag
- **WHEN** a separator is dragged repeatedly up and down, reaching both limits
- **THEN** the preview follows continuously and remains clamped

#### Scenario: Cancelled drag
- **WHEN** a drag is cancelled
- **THEN** the snapshot allocations are restored

### Requirement: Independent size preferences per pane
Preferred dimensions SHALL be keyed by pane id. Temporary normalization SHALL NOT rewrite them.
A successful user resize SHALL update every affected preference together. Preferences SHALL
survive reorder, collapse and expand cycles, temporary container shrinkage, project switching, and
restoration.

#### Scenario: Shrink and regrow
- **WHEN** the window shrinks so panes are normalized and then regrows
- **THEN** each pane returns to its saved preference

### Requirement: Keyboard resizing
Arrow Up, Arrow Down, Home, and End SHALL resize through the same geometry operations as pointer
input, and separators SHALL expose complete ARIA values.

#### Scenario: Keyboard resize
- **WHEN** a focused separator receives Arrow Up, Arrow Down, Home, or End
- **THEN** the same geometry operation runs as for the equivalent pointer movement and the ARIA values update

### Requirement: Pointer gesture handling
Drags SHALL use pointer capture with document and window completion safeguards, SHALL suppress
text selection while dragging, and SHALL clean up listeners, capture, and transient styles after
pointer-up, cancellation, lost capture, and unmount.

#### Scenario: Lost pointer capture
- **WHEN** pointer capture is lost or the component unmounts mid-drag
- **THEN** listeners, capture, and transient styles are cleaned up and no canonical write occurs

### Requirement: Preview and commit boundary for resizing
Pointer movement SHALL send no workspace update. A completed vertical resize SHALL submit exactly
one bounded project sidebar patch containing every changed pane dimension. A cancelled resize SHALL
submit nothing. A completed sidebar-width resize SHALL likewise submit exactly one update, and
width pointer movement SHALL NOT persist on every event.

#### Scenario: Command counts during a drag
- **WHEN** a separator is dragged and released
- **THEN** zero updates are sent during movement and exactly one atomic project update is sent on completion

#### Scenario: Cancelled resize writes nothing
- **WHEN** a resize is cancelled
- **THEN** no workspace update is sent

#### Scenario: Width resize
- **WHEN** the sidebar width is resized and released
- **THEN** exactly one width update is sent and none during movement

### Requirement: Snapshot reconciliation and validation
A canonical snapshot received during an interaction SHALL NOT replace the live preview. After
completion the authoritative result SHALL be accepted, while a stale response SHALL be rejected or
ordered so that an older height cannot replace a newer committed one. A failed commit SHALL retain
the last authoritative state, end the interaction cleanly, expose the existing operation failure
path, and permit a subsequent resize.

#### Scenario: Snapshot during a drag
- **WHEN** a canonical snapshot arrives while a resize is in progress
- **THEN** the preview is preserved and the snapshot is reconciled without visual snap-back

#### Scenario: Stale response after commit
- **WHEN** a response carrying an older height arrives after a newer commit
- **THEN** it is rejected or ordered so the committed value stands

#### Scenario: Failed commit
- **WHEN** the commit fails
- **THEN** the last authoritative state is retained, the failure is surfaced through the existing path, and a subsequent resize is permitted

### Requirement: Project-scoped layout persistence
A sidebar resize SHALL write only to the interacting project. It SHALL NOT write to another
project and SHALL NOT rewrite global Settings defaults, which remain the defaults for new projects.
A restart, reload, or reconnect SHALL restore only committed project-local state.

#### Scenario: No cross-project writes
- **WHEN** a project's sidebar is resized
- **THEN** no other project and no global Settings default is written

#### Scenario: Restored after restart
- **WHEN** the workspace is reloaded, restarted, or reconnected
- **THEN** only committed project-local sidebar state is restored

### Requirement: Minimum host height for the sidebar
The supported-host minimum height SHALL be defined explicitly. When the title budget cannot be
satisfied, the layout SHALL report that state explicitly rather than relying on overflow or
clipped content.

#### Scenario: Impossible title budget
- **WHEN** the container is shorter than the total title budget of the visible panes
- **THEN** the impossible state is explicit rather than producing clipped or off-screen titles

### Requirement: Cross-client layout restoration
A second presentation of the same project SHALL receive the committed sidebar state.

#### Scenario: Second presentation
- **WHEN** the same project is opened in another presentation after a committed resize
- **THEN** it renders the committed pane dimensions
