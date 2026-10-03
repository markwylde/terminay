## ADDED Requirements

### Requirement: Dropping a terminal tab on a project tab

A terminal tab SHALL be droppable on a visible project tab in the project bar, and that drop SHALL move the terminal into that project with the same outcome as choosing that project from the tab's **Move to project** context action: the terminal keeps its session identity, scrollback, title, colour, emoji, note, and recording state, the target project becomes the active project, and the moved terminal is the focused terminal there.

A project tab SHALL accept the drop only when it is a project the context action would offer for that terminal: a ready project owned by the same server as the terminal, other than the terminal's own project. The terminal's own project tab, a project owned by another server, a pending or failed project tab, an inert project tab, the Home control, and every other project bar control SHALL NOT accept the drop, and releasing a terminal tab over one of them SHALL leave the terminal where it was.

While a terminal tab is dragged over a project tab that accepts it, that project tab SHALL be visibly marked as the drop target, and the mark SHALL clear when the pointer leaves the tab or the drag ends. A project tab that does not accept the drop SHALL show no drop affordance. Dragging a terminal tab over the project bar SHALL NOT activate, reorder, or tear off any project tab.

Only a dragged terminal tab SHALL be moved this way. A dragged file tab, folder tab, or whole panel group SHALL NOT be accepted by a project tab. Dropping a terminal tab on a project tab SHALL NOT also pop the terminal out into its own window.

#### Scenario: Dropping a terminal on another project
- **WHEN** a user drags a terminal tab from the active project and releases it on another project's tab on the same server
- **THEN** the terminal leaves its project, appears in the target project with its session, scrollback, and tab presentation intact, the target project becomes active, and the moved terminal is focused

#### Scenario: Same result as the context action
- **WHEN** one terminal is moved by dropping it on a project tab and another is moved to the same project through **Move to project**
- **THEN** both terminals end in the target project in the same state, and no second terminal or session is created for either

#### Scenario: Hovering an eligible project tab
- **WHEN** a dragged terminal tab is held over a project tab that accepts it
- **THEN** that project tab is marked as the drop target, and the mark clears when the pointer leaves it

#### Scenario: Releasing on the terminal's own project
- **WHEN** a terminal tab is released on the tab of the project it already belongs to
- **THEN** no drop affordance is shown and the terminal stays where it was

#### Scenario: Another server's project
- **WHEN** a terminal tab is dragged over a project tab owned by a different attached server
- **THEN** that tab shows no drop affordance and releasing there moves nothing

#### Scenario: Pending or inert project tab
- **WHEN** a terminal tab is dragged over a project tab that is still being created, failed creation, or belongs to an unreachable server
- **THEN** that tab shows no drop affordance and releasing there moves nothing

#### Scenario: Home control and bar chrome
- **WHEN** a terminal tab is released on the Home control, the `+` control, or empty project bar space
- **THEN** nothing is moved and the terminal stays in its project

#### Scenario: Dragging something other than a terminal tab
- **WHEN** a file tab, a folder tab, or a whole panel group is dragged over a project tab
- **THEN** the project tab shows no drop affordance and releasing there moves nothing

#### Scenario: Project bar is undisturbed by the drag
- **WHEN** a terminal tab is dragged across the project bar and released without an eligible target
- **THEN** the active project, the project tab order, and the set of native windows are unchanged
