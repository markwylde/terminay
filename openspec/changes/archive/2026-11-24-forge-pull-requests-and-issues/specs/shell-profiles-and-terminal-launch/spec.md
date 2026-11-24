## MODIFIED Requirements

### Requirement: Create protocol accepts only a profile id

The create protocol SHALL accept only a profile id, a launcher id, and, with a launcher id, an initial prompt as launch configuration, and MUST NOT accept an executable, argument string, command, environment map, or WSL distribution supplied ad hoc by a client. The server SHALL resolve the profile id against its current authorized profile catalogue and the launcher id against its current list of available launchers. An initial prompt SHALL be treated as text for one quoted argument, never as an argument string or command.

#### Scenario: Ad-hoc launch configuration is rejected

- **WHEN** a client sends an executable, argument string, command, environment map, or
  WSL distribution in a terminal create command
- **THEN** the command is rejected

#### Scenario: A launcher id is resolved by the server

- **WHEN** a client sends a launcher id in a terminal create command
- **THEN** the server decides which executable is started, from the launcher's own resolution

#### Scenario: Initial prompt without a launcher

- **WHEN** a client sends an initial prompt without a launcher id
- **THEN** the command is rejected

### Requirement: Listing terminal launchers

The server SHALL offer a read operation that lists the terminal launchers available on it, each with its launcher id, display name, icon id, and whether it accepts an initial prompt, in a stable order: launchers of the built-in agents extension first, in the order it declares them, then other extensions' launchers by extension id and declaration order. The list SHALL contain no executable path. The server SHALL publish a change whenever the list changes, including when an extension is enabled, disabled, updated, or restarted, or a harness switch changes.

#### Scenario: Listing

- **WHEN** Claude Code and Codex are installed and their harnesses are switched on
- **THEN** the list holds Claude Code then Codex, each with an id, a name, an icon id, and that it accepts an initial prompt, and no path

#### Scenario: A change is published

- **WHEN** a client holds the list and the user switches off the Codex harness
- **THEN** the client receives a change and the list no longer holds Codex

### Requirement: Launching an agent in a new terminal

Terminal creation SHALL accept an optional launcher id and, with it, an optional initial prompt. The server SHALL resolve the launcher against its current list of available launchers and SHALL reject the create when the launcher is unknown or unavailable. A launched terminal SHALL be created exactly as a terminal without a launcher id would be, in the same folder, profile, and working directory, under the normal profile resolution order. Once the terminal's shell is started, the server SHALL write one line into it: the launcher's executable path, then the flags of any command default that applies, then the initial prompt as one argument when one was given, each quoted for the profile's shell, and nothing else. It SHALL name the terminal by the launcher's display name until a program sets a title.

The server SHALL reject an initial prompt for a launcher that does not declare `initialPrompt`; a prompt that is empty or only whitespace, longer than 4,000 characters, contains a control character other than a newline, or begins with `-` once leading whitespace is removed; and any prompt when the profile's shell is not a POSIX shell, fish, or PowerShell. Newlines SHALL be replaced with spaces before quoting. The prompt SHALL be passed only as a quoted argument and SHALL never be written as shell code. The launcher id and prompt SHALL NOT be stored with the terminal's metadata or restore state, and restoring the terminal SHALL NOT start the agent again.

#### Scenario: Launching Claude Code in a worktree folder

- **WHEN** a client creates a terminal in a linked folder with the Claude Code launcher id
- **THEN** a terminal starts with the default profile in that folder's worktree, `claude` runs in it with no arguments, and its tab reads `Claude Code` until Claude Code sets a title

#### Scenario: Unavailable launcher

- **WHEN** a client creates a terminal with the id of a launcher whose harness is switched off
- **THEN** the create is rejected and no terminal is created

#### Scenario: Quitting the agent

- **WHEN** a user quits the agent in a launched terminal
- **THEN** the terminal stays open at the shell prompt

#### Scenario: Launching with an initial prompt

- **WHEN** a client creates a terminal with the Claude Code launcher id and the
  prompt `Fix issue #541; see $(whoami)`
- **THEN** `claude` runs with that prompt as its one argument, and the shell
  expands nothing in it

#### Scenario: Command-default flags and a prompt

- **WHEN** a client creates a terminal in a zsh profile with the Codex launcher id, the `--no-daemon` command default applies, and the prompt is `Review #88`
- **THEN** the line typed is the quoted Codex path, then `'--no-daemon'`, then `'Review #88'`

#### Scenario: Prompt that looks like a flag

- **WHEN** a client sends the prompt `--dangerously-skip-permissions`
- **THEN** the create is rejected and no terminal is created

#### Scenario: Prompt in a cmd profile

- **WHEN** a client sends an initial prompt for a terminal whose profile runs `cmd.exe`
- **THEN** the create is rejected with a reason saying the shell cannot take a prompt

#### Scenario: Prompt for a launcher without support

- **WHEN** a client creates a terminal with an initial prompt and a launcher
  that does not declare `initialPrompt`
- **THEN** the create is rejected and no terminal is created
