## ADDED Requirements

### Requirement: Terminal close protection

Closing an idle terminal SHALL proceed immediately. Closing a terminal whose session reports `foregroundBusy` SHALL ask whether to **Close Terminal** or **Keep Running** before terminating it, with **Keep Running** as both the default and the cancel action.

#### Scenario: Idle terminal

- **WHEN** a terminal at its shell prompt is closed
- **THEN** it closes immediately

#### Scenario: Busy terminal

- **WHEN** a terminal whose session reports `foregroundBusy` is closed
- **THEN** Terminay asks whether to Close Terminal or Keep Running before terminating it

#### Scenario: Dismissing the dialog

- **WHEN** the user accepts the default or cancels the busy close dialog
- **THEN** Keep Running is selected and the terminal is not terminated

### Requirement: Project close protection

Closing a project SHALL proceed immediately when none of its terminals report `foregroundBusy`. If one or more do, Terminay SHALL report the affected terminal count and ask whether to **Close Project** or **Keep Running**. A session SHALL be counted once. Moving a project or terminal between views SHALL NOT be a close, SHALL NOT display a warning, and SHALL NOT terminate a PTY.

#### Scenario: All terminals idle

- **WHEN** a project whose terminals are all idle is closed
- **THEN** it closes immediately

#### Scenario: One busy terminal protects the project

- **WHEN** one of a project's terminals reports `foregroundBusy`
- **THEN** the affected terminal count is reported and Close Project or Keep Running is offered

#### Scenario: Moving instead of closing

- **WHEN** a project or terminal moves between views
- **THEN** no close warning is shown and no PTY is terminated

### Requirement: Native window close protection

Each Desktop project-host window SHALL publish a bounded busy-session set to the privileged main process. That set SHALL carry session identity and busy state only, and no terminal content. A native close of a window whose set is non-empty SHALL ask whether to **Quit Terminay** or **Keep Running**. Confirming SHALL close only the target project window; sibling windows SHALL remain alive and usable. Application quit SHALL be reserved for the final project window or an explicit Quit command, and an explicit Quit command SHALL bypass this window-scoped guard. Confirmed operations SHALL retain the existing server-owned termination and graceful shutdown semantics.

#### Scenario: Busy torn-off window closed

- **WHEN** a non-final project window with a busy session is closed and the user confirms
- **THEN** only that window closes and its sibling windows remain alive and usable

#### Scenario: Final project window

- **WHEN** the final project window with a busy session is closed
- **THEN** the Quit Terminay warning and the graceful shutdown path are used

#### Scenario: Explicit quit

- **WHEN** the user issues an explicit Quit command
- **THEN** the window-scoped close guard is bypassed

#### Scenario: Published set contents

- **WHEN** a window publishes its busy-session set
- **THEN** it contains session identity and busy state only, without terminal content

### Requirement: Close warnings depend only on canonical PTY state

Terminal, project, and window close warnings SHALL depend only on canonical `foregroundBusy` state. Provider state, recent output, agent status, tab attention, and activity-indicator settings SHALL neither create nor suppress a warning.

#### Scenario: Noisy but idle terminal

- **WHEN** a terminal has recent output or agent attention but no non-shell foreground process
- **THEN** closing it produces no warning

#### Scenario: Indicator settings disabled

- **WHEN** activity indicator settings are disabled while a non-shell foreground process runs
- **THEN** the close warning is still shown
