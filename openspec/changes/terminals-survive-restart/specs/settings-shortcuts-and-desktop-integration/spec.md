## MODIFIED Requirements

### Requirement: Application close confirmation

Closing Terminay SHALL proceed immediately when every terminal is at its shell prompt, and SHALL keep every terminal session running in the background. If any terminal in any open project has a non-shell foreground process, Desktop SHALL report the affected terminal count, state how long terminals keep running in the background, and ask whether to **Quit and Keep Terminals**, **Quit and End Terminals**, or **Cancel**. **Quit and Keep Terminals** SHALL be the default action and SHALL quit Terminay with every terminal session still running. **Quit and End Terminals** SHALL end every terminal session, remove their terminal panels, and quit. **Cancel** SHALL be the cancel action and SHALL leave Terminay open. One accepted quit SHALL enter graceful shutdown without showing a second confirmation.

#### Scenario: Idle application closes

- **WHEN** every terminal is at its shell prompt and the user closes Terminay
- **THEN** the application closes without a warning and every terminal session keeps running in the background

#### Scenario: Foreground work present

- **WHEN** any terminal in any open project has a non-shell foreground process and the user closes Terminay
- **THEN** Desktop reports the affected terminal count and the background time limit, and offers **Quit and Keep Terminals**, **Quit and End Terminals**, and **Cancel**, with **Quit and Keep Terminals** as the default action and **Cancel** as the cancel action

#### Scenario: Keep Running chosen

- **WHEN** the user dismisses the close alert or chooses **Cancel**
- **THEN** Terminay stays open and every project and terminal keeps running

#### Scenario: Quit accepted

- **WHEN** the user chooses **Quit and Keep Terminals** or **Quit and End Terminals**
- **THEN** graceful shutdown proceeds without a second confirmation

#### Scenario: Terminals kept

- **WHEN** the user chooses **Quit and Keep Terminals**
- **THEN** Terminay quits and every terminal session keeps running in the background

#### Scenario: Terminals ended

- **WHEN** the user chooses **Quit and End Terminals**
- **THEN** every terminal session ends, Terminay quits, and the next launch shows none of those terminal panels

## ADDED Requirements

### Requirement: Restart to update keeps terminals

Choosing **Restart to update** SHALL quit Terminay, install the update, and relaunch with every terminal session still running. It SHALL NOT show the application close confirmation, whether or not a terminal has a foreground process.

#### Scenario: Update restart with foreground work

- **WHEN** a terminal has a non-shell foreground process and the user chooses **Restart to update**
- **THEN** no confirmation is shown, and Terminay relaunches as the new version with that process still running in its terminal

#### Scenario: Update restart preserves the workspace

- **WHEN** Terminay relaunches after **Restart to update**
- **THEN** every project tab, terminal panel, and layout is as it was before the restart

### Requirement: Background terminal lifetime setting

Settings SHALL offer a server-owned setting for how long terminals keep running after Terminay quits, defaulting to 5 minutes and including a value that keeps them until the machine restarts.

#### Scenario: Default value

- **WHEN** a user opens the setting on a server where it has never been changed
- **THEN** it shows 5 minutes

#### Scenario: Value changed

- **WHEN** a user selects a different value
- **THEN** the application close confirmation states the new limit and terminals are kept for that long after the next quit
