## ADDED Requirements

### Requirement: Listing terminal launchers

The server SHALL offer a read operation that lists the terminal launchers available on it, each with its launcher id, display name, and icon id, in a stable order: launchers of the built-in agents extension first, in the order it declares them, then other extensions' launchers by extension id and declaration order. The list SHALL contain no executable path. The server SHALL publish a change whenever the list changes, including when an extension is enabled, disabled, updated, or restarted, or a harness switch changes.

#### Scenario: Listing

- **WHEN** Claude Code and Codex are installed and their harnesses are switched on
- **THEN** the list holds Claude Code then Codex, each with an id, a name, and an icon id, and no path

#### Scenario: A change is published

- **WHEN** a client holds the list and the user switches off the Codex harness
- **THEN** the client receives a change and the list no longer holds Codex

### Requirement: Launching an agent in a new terminal

Terminal creation SHALL accept an optional launcher id. The server SHALL resolve the launcher against its current list of available launchers and SHALL reject the create when the launcher is unknown or unavailable. A launched terminal SHALL be created exactly as a terminal without a launcher id would be, in the same folder, profile, and working directory, under the normal profile resolution order. Once the terminal's shell is started, the server SHALL write the launcher's executable path into it as one line, quoted for the profile's shell, with no arguments, and SHALL name the terminal by the launcher's display name until a program sets a title. The launcher id SHALL NOT be stored with the terminal, and restoring the terminal SHALL NOT start the agent again.

#### Scenario: Launching Claude Code in a worktree folder

- **WHEN** a client creates a terminal in a linked folder with the Claude Code launcher id
- **THEN** a terminal starts with the default profile in that folder's worktree, `claude` runs in it with no arguments, and its tab reads `Claude Code` until Claude Code sets a title

#### Scenario: Unavailable launcher

- **WHEN** a client creates a terminal with the id of a launcher whose harness is switched off
- **THEN** the create is rejected and no terminal is created

#### Scenario: Quitting the agent

- **WHEN** a user quits the agent in a launched terminal
- **THEN** the terminal stays open at the shell prompt

## MODIFIED Requirements

### Requirement: Create protocol accepts only a profile id

The create protocol SHALL accept only a profile id and a launcher id as launch configuration, and MUST NOT accept an executable, argument string, command, environment map, or WSL distribution supplied ad hoc by a client. The server SHALL resolve the profile id against its current authorized profile catalogue and the launcher id against its current list of available launchers.

#### Scenario: Ad-hoc launch configuration is rejected

- **WHEN** a client sends an executable, argument string, command, environment map, or
  WSL distribution in a terminal create command
- **THEN** the command is rejected

#### Scenario: A launcher id is resolved by the server

- **WHEN** a client sends a launcher id in a terminal create command
- **THEN** the server decides which executable is started, from the launcher's own resolution
