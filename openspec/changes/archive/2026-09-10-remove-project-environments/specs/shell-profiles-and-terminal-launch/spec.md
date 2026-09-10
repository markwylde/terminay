## ADDED Requirements

### Requirement: Server-scoped catalogues and defaults

Shell catalogue, System default, account home, executable validation, startup
mode, working directory, and launch environment SHALL resolve against the server
that owns the project. Shell-profile catalogues SHALL belong to one Terminay
Server. A client connected to another server SHALL see that server's catalogues
and MUST NOT send a local executable path as another server's default.

#### Scenario: Server profiles resolve normally

- **WHEN** a terminal is created in a project
- **THEN** the owning server's profiles resolve normally

#### Scenario: Cross-host boundary cannot be widened

- **WHEN** a remote client attempts to select a local-only profile
- **THEN** the request is rejected and its server, project, and session scope is
  unchanged, including across reconnect

### Requirement: Launch targets

A launch target SHALL be one of `system`, resolved from the server account at
launch time; `executable`, containing a native executable path or a
platform-valid executable name; or `wsl`, containing a Windows Subsystem for
Linux distribution and optional shell path. The WSL target's fields MUST NOT be
encoded into one command string.

#### Scenario: Executable target

- **WHEN** a profile uses an `executable` target
- **THEN** the server validates that native executable path or platform-valid
  name before spawn

#### Scenario: WSL target stays structured

- **WHEN** a profile uses a `wsl` target
- **THEN** the distribution and optional shell path remain separate structured
  fields, so spaces and command arguments cannot alter the selected distribution

### Requirement: System default platform policy

The reserved System default profile SHALL follow the server host's platform
policy. On macOS it SHALL launch a supported POSIX account shell as a login
shell, matching a normal terminal login and allowing the user's login startup
files to establish `PATH` and related command-discovery environment. This policy
MUST NOT inspect or hard-code installed tool paths. An explicit custom profile's
Shell default mode SHALL remain the selected shell's unmodified default
behaviour.

#### Scenario: macOS default gives a login shell

- **WHEN** a macOS user whose account shell is zsh creates a terminal with
  default settings
- **THEN** an interactive login zsh starts in the project or inherited working
  directory, with the login-file environment available for discovering
  user-installed commands

#### Scenario: Custom profile is not silently upgraded to login

- **WHEN** a custom profile uses Shell default mode
- **THEN** the selected shell runs with its unmodified default behaviour

### Requirement: Shell discovery

Discovery SHALL execute on the server and SHALL return capability data rather
than persisted settings. Refreshing discovery MAY add, remove, or mark candidates
unavailable without rewriting a custom profile or changing the selected default.

#### Scenario: Refresh does not rewrite configuration

- **WHEN** discovery is refreshed and a candidate disappears
- **THEN** custom profiles and the selected default are unchanged and the
  candidate is marked unavailable

#### Scenario: Discovery lists only the PTY host's profiles

- **WHEN** discovery runs for a Linux, macOS, Windows native, or Windows WSL
  server
- **THEN** only profiles available on the machine that will run the PTY are
  exposed

## MODIFIED Requirements

### Requirement: Profile catalogue composition

The profile catalogue SHALL contain one reserved, undeletable **System default**
profile, read-only profiles discovered from the server operating system, and
durable custom profiles created or copied by the user. System default SHALL
require no configuration. Named custom profiles SHALL be supported.

#### Scenario: System default cannot be deleted

- **WHEN** the user attempts to delete the reserved System default profile
- **THEN** the deletion is rejected

#### Scenario: Zero-configuration launch

- **WHEN** no profile has been configured
- **THEN** terminals launch from System default without further configuration

### Requirement: New terminals start in policy

The server setting **New terminals start in** SHALL support **Current terminal
or panel** (the default), which inherits the active terminal's live working
directory, the active folder, or the containing directory of the active file in
the target project; **Project folder**, which uses the canonical root of the
target project; and **Home folder**, which uses the verified account home
reported by the server. Working-directory selection SHALL be part of the
canonical launch resolver but SHALL be configured separately from shell profiles.

#### Scenario: Current terminal or panel

- **WHEN** the policy is Current terminal or panel and a file panel is active
- **THEN** the new terminal starts in the containing directory of that file in
  the target project

#### Scenario: Home folder

- **WHEN** the policy is Home folder
- **THEN** the new terminal starts in the account home verified by the server

### Requirement: Working-directory resolution order

For the default policy, the resolver SHALL consider inputs in this order: an
explicit working directory from an authorized user action; a verified live
working directory from the active terminal, folder, or file panel; the target
project's canonical root; then the server's verified account home, only when the
project has no usable root by design. An explicitly requested missing or
non-directory path SHALL fail and MUST NOT be retargeted. A stale observed panel
working directory MAY fall through to the canonical project root. A configured
project root that has become missing or inaccessible SHALL remain a recoverable
project error and MUST NOT be silently replaced with home.

#### Scenario: Explicit path is missing

- **WHEN** an authorized action requests a working directory that does not exist
  or is not a directory
- **THEN** creation fails and the request is not retargeted to another directory

#### Scenario: Missing project root

- **WHEN** the configured project root is missing or inaccessible
- **THEN** a recoverable project error is presented and home is not substituted

#### Scenario: Stale panel cwd

- **WHEN** the observed panel working directory is stale
- **THEN** resolution falls through to the canonical project root

#### Scenario: Project opened at home

- **WHEN** a project rooted at the user's home directory creates its first and
  subsequent terminals
- **THEN** each starts in that home directory

## REMOVED Requirements

### Requirement: Environment-scoped catalogues and defaults

**Reason:** The project environment concept is removed, so a catalogue is scoped
by the server that owns the project rather than by an environment capability.

**Migration:** None. The surviving scoping rules are stated in "Server-scoped
catalogues and defaults".

### Requirement: This server launch targets

**Reason:** The header names the built-in "This server" environment, which no
longer distinguishes anything: every launch target belongs to the server that
owns the project.

**Migration:** None. The target definitions are kept as "Launch targets".

### Requirement: This server System default platform policy

**Reason:** The header names the built-in "This server" environment, and there is
no other provider with its own system-default semantics.

**Migration:** None. The policy is kept as "System default platform policy".

### Requirement: Environment-routed shell discovery

**Reason:** Discovery is no longer routed through a project environment; it runs
on the server that owns the project.

**Migration:** None. The surviving discovery rules are stated in "Shell
discovery".
