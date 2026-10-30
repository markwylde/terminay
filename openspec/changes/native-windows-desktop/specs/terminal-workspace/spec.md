## MODIFIED Requirements

### Requirement: Current-directory and foreground-process observation

Current-directory and foreground-process observation SHALL inspect the session's own PTY process on the server that owns it. On Windows, the foreground process SHALL be the deepest descendant of the session's shell, found from one snapshot of the process table, that is not a console host or PTY helper. The current directory SHALL be the directory Windows records for that process, or for the shell when the descendant's cannot be read. PowerShell does not move its process's directory when its location changes, so an interactive PowerShell that Terminay starts on Windows SHALL, after its profiles load, wrap the prompt it has so that each prompt first sets the process directory to the current filesystem location; what the prompt draws SHALL be unchanged, and a PowerShell started with its own command, script, or `-NonInteractive` SHALL start exactly as configured. Observation SHALL NOT start a process for each observation, SHALL NOT otherwise change the shell's prompt or environment, and SHALL report `limited` rather than a guess when the process cannot be read, including for a WSL distribution's processes, which run outside Windows.

#### Scenario: Observing a session

- **WHEN** a terminal session's current directory or foreground process is observed
- **THEN** the server inspects that session's own PTY process

#### Scenario: Split inherits the directory on Windows

- **WHEN** a user runs `cd C:\src\app` in a PowerShell terminal and then splits it
- **THEN** the new terminal starts in `C:\src\app`

#### Scenario: PowerShell prompt is unchanged

- **WHEN** a user whose PowerShell profile customises the prompt opens a PowerShell terminal on Windows
- **THEN** the prompt draws exactly as their profile defines it, and the terminal's directory follows each `Set-Location` into a filesystem path

#### Scenario: Running command on Windows

- **WHEN** a Command Prompt terminal is running `node server.js`
- **THEN** the foreground process is reported as `node` and close protection counts that terminal as busy

#### Scenario: WSL terminal

- **WHEN** a terminal runs a WSL distribution profile
- **THEN** its current directory and foreground process are reported as `limited`, because the distribution's processes are not visible from Windows, and the terminal is not treated as idle
