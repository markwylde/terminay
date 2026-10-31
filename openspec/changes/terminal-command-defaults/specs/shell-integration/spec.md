## ADDED Requirements

### Requirement: Supported shells and fallback

Terminay Server SHALL provide shell integration for zsh, bash, fish, and PowerShell (`pwsh` and Windows PowerShell). Integration SHALL apply to a terminal only when its resolved program is one of those shells and its profile arguments are empty or exactly a form Terminay recognises for that shell's interactive or login start. On Windows only PowerShell SHALL be integrated, because a `bash.exe` there may be WSL's launcher or Git Bash, whose paths differ from the server's. Any other shell, a WSL profile, or a profile whose arguments Terminay does not recognise SHALL start exactly as it would without integration, with no integration arguments or environment added and no error.

#### Scenario: Supported shell with default arguments

- **WHEN** a terminal launches `/bin/zsh` from a profile with no arguments
- **THEN** shell integration is applied to that terminal

#### Scenario: bash on Windows

- **WHEN** a Windows terminal launches `bash.exe`
- **THEN** it starts exactly as it would without integration

#### Scenario: Unsupported shell

- **WHEN** a terminal launches `/bin/dash`, `nu`, `tcsh`, or another shell outside the supported set
- **THEN** it starts with exactly the program, arguments, and environment it would have without integration

#### Scenario: Unrecognised profile arguments

- **WHEN** a bash profile passes `--norc`
- **THEN** integration is not applied and the profile's arguments are passed unchanged

### Requirement: The user's own startup files run first and are never written

When integration applies, the shell SHALL load the same user and system startup files, in the same order, that it would load for that start mode without integration, and only then run Terminay's integration code. Terminay SHALL NOT create, edit, append to, or replace any file in the user's home directory or any shell startup file outside Terminay's own integration directory. A login start SHALL remain a login start. zsh SHALL keep reading and writing the user's own history file.

#### Scenario: zsh login shell

- **WHEN** a zsh login terminal starts with integration
- **THEN** the user's `.zshenv`, `.zprofile`, `.zshrc`, and `.zlogin` run in zsh's normal order before Terminay's integration code, and none of those files is modified

#### Scenario: User has a custom ZDOTDIR

- **WHEN** the user's environment or the profile overlay sets `ZDOTDIR`
- **THEN** the user's startup files are read from that directory, and `ZDOTDIR` inside the running shell is the user's value once startup finishes

#### Scenario: bash login shell

- **WHEN** a bash login terminal starts with integration
- **THEN** `/etc/profile` and the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists run before Terminay's integration code

### Requirement: Integration runs once per terminal shell

Integration code SHALL run at most once in a terminal's top-level shell. A shell started from inside an integrated shell SHALL NOT run integration again and SHALL behave as it would without Terminay.

#### Scenario: Nested shell

- **WHEN** the user types `zsh` inside an integrated zsh terminal
- **THEN** the inner shell does not run Terminay's integration code

### Requirement: Integration files are private to the server account

Integration scripts SHALL be served from a directory that only the server account can write. A per-user runtime directory that zsh integration requires SHALL be created with owner-only permissions, and Terminay SHALL refuse to use it, and skip integration, when it is owned by another account or writable by others.

#### Scenario: Tampered runtime directory

- **WHEN** the zsh runtime directory exists and is writable by another account
- **THEN** integration is skipped for that terminal and the shell starts as it would without integration

### Requirement: Terminal command defaults registry

Terminay Server SHALL keep a registry of terminal command defaults. An entry SHALL consist of a command name and an ordered list of arguments to place before the user's arguments. A command name SHALL be a single word of letters, digits, `.`, `_`, or `-`, and SHALL NOT be a builtin or reserved word of any supported shell. Each argument SHALL begin with `-`, SHALL contain no control characters, and SHALL be bounded in length, and an entry SHALL have a bounded number of arguments. Entries SHALL be data only: Terminay generates all shell code and quoting from them, and no entry can supply shell code. When two sources register the same command name, neither entry SHALL apply and a diagnostic SHALL name both sources.

#### Scenario: Argument that is not a flag

- **WHEN** a source registers the argument `exec` for a command
- **THEN** the entry is refused

#### Scenario: Shell builtin as command name

- **WHEN** a source registers a default for `cd`
- **THEN** the entry is refused

#### Scenario: Conflicting registrations

- **WHEN** two extensions register defaults for the same command name
- **THEN** neither applies in new terminals and a diagnostic names both extensions

#### Scenario: Metacharacters in an argument

- **WHEN** an entry's argument contains spaces, quotes, `$`, or `;`
- **THEN** the shell receives it as one literal argument and nothing in it is evaluated

### Requirement: Command defaults apply as shell functions in new terminals

In a terminal with integration, after the user's startup files have run, Terminay SHALL define each registry entry as a shell function of that command name which runs the command found on `PATH`, bypassing functions and aliases, with the entry's arguments followed by the user's arguments. When the user's startup files already define an alias or function with that name, Terminay SHALL leave it in place and not define its own. Entries SHALL be captured when the terminal starts; later registry changes SHALL affect only terminals created afterwards.

#### Scenario: Typed command receives the default

- **WHEN** an entry maps `codex` to `--no-daemon` and the user types `codex resume --last` in an integrated terminal
- **THEN** the executable `codex` found on `PATH` runs with the arguments `--no-daemon resume --last`

#### Scenario: User already defines the command

- **WHEN** the user's `.zshrc` defines an alias or function named `codex`
- **THEN** the user's definition is unchanged and Terminay defines nothing for `codex`

#### Scenario: Registry changes while a terminal runs

- **WHEN** an entry is removed while a terminal is running
- **THEN** that terminal keeps the function it started with, and only terminals created afterwards lack it

#### Scenario: Command not installed

- **WHEN** an entry's command is not on `PATH` in that shell
- **THEN** typing it fails exactly as it would without the entry

### Requirement: Launchers apply command defaults

When a terminal launcher starts an executable whose file name matches a registry entry's command name, Terminay SHALL type the entry's arguments, quoted for the shell, after the executable path. No other arguments SHALL be typed.

#### Scenario: Codex launcher

- **WHEN** an entry maps `codex` to `--no-daemon` and the user chooses the Codex launcher
- **THEN** Terminay types the absolute Codex path followed by `--no-daemon` and Enter

#### Scenario: No entry

- **WHEN** no entry matches the launcher's executable
- **THEN** Terminay types only the executable path

### Requirement: Shell integration setting

**Settings → Shell → Shell integration** SHALL be server-scoped, persisted, and on by default. MCP settings tools SHALL NOT read or change it. Turning it off SHALL stop integration and command defaults for terminals created afterwards and SHALL NOT change running terminals. Launchers SHALL still apply command defaults while the setting is off, because they do not depend on the shell.

#### Scenario: Setting turned off

- **WHEN** the user turns shell integration off and opens a new terminal
- **THEN** the shell starts with exactly the program, arguments, and environment of its profile, and no command default functions are defined
