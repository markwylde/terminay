## ADDED Requirements

### Requirement: Open Command Bar command reach

**Open Command Bar** SHALL be reachable without a keyboard on every host. It SHALL appear in the Desktop application menu and in the browser host's in-page menu, and SHALL be rebindable in the shortcut settings surface like every other command, with a default accelerator of `CmdOrCtrl+L`. On a host with no keyboard it SHALL additionally be reachable from a workspace chrome control, because it is the only route to the commands and macros the compact chrome draws no control for.

#### Scenario: Browser host in-page menu
- **WHEN** a user opens the browser host's View menu
- **THEN** **Open Command Bar** is listed there and invoking it opens the Command Bar

#### Scenario: Desktop native menu
- **WHEN** a user opens the Desktop application menu
- **THEN** **Open Command Bar** is listed there with its configured accelerator

#### Scenario: A host with no keyboard
- **WHEN** a workspace is presented on a host that cannot send `CmdOrCtrl+L`
- **THEN** a chrome control opens the Command Bar without any keystroke

### Requirement: Editing commands

Tab editing and project editing SHALL be first-class application commands. **Edit Active Tab** SHALL open the editor for the terminal, file, or folder tab in front, and **Edit Active Project** SHALL open the editor for the project in front. Both SHALL be searchable in the Command Bar, SHALL appear in the Desktop application menu and in the browser host's in-page menu, and SHALL be rebindable in the shortcut settings surface like every other command, with no default accelerator. Each SHALL open the same editor its direct gesture opens, in the current host's auxiliary-route presentation, so an editor is never reachable by gesture alone.

#### Scenario: Editing the tab in front
- **WHEN** a user invokes **Edit Active Tab** with a tab in front
- **THEN** that tab's editor opens, the same editor a double-click or long-press on it opens

#### Scenario: Editing the project in front
- **WHEN** a user invokes **Edit Active Project** with a project in front
- **THEN** that project's editor opens, the same editor a long press on its switcher heading opens

#### Scenario: Nothing in front
- **WHEN** a user invokes **Edit Active Tab** with no tab in front
- **THEN** no editor opens and the workspace reports that a tab must be open first

#### Scenario: Searchable in the Command Bar
- **WHEN** a user searches the Command Bar for either command
- **THEN** it is returned with its user-configured shortcut shown

### Requirement: In-page menu commands do not depend on a binding

A host that draws its application menu in page SHALL invoke a command by naming it, not by synthesising the keystroke its accelerator would produce. A command that ships with no default binding SHALL therefore be invocable from that menu, and SHALL reach the same dispatch the Desktop native menu and the accelerator reach.

#### Scenario: An unbound command in the in-page menu
- **WHEN** a user selects an in-page menu entry for a command that has no accelerator bound
- **THEN** the command runs

#### Scenario: One dispatch for every route
- **WHEN** a command is invoked from the in-page menu, the native menu, or its accelerator
- **THEN** all three reach the same command dispatch
