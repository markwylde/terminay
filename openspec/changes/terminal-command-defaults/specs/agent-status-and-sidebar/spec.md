## MODIFIED Requirements

### Requirement: Terminal binding by process ancestry

Terminay SHALL bind a live session to a terminal when the session's owning process is that terminal's PTY shell process or a descendant of it, and that owning process's controlling terminal is the same terminal device as the PTY shell's. Terminay SHALL NOT bind by working directory, title, focus, or timing. A process that is detached from any controlling terminal, or whose controlling terminal differs from the shell's, SHALL NOT bind to that terminal even while it descends from the shell. Binding SHALL be re-evaluated when the session is first reported, when its owning process changes, and when a terminal's foreground process changes. Process ancestry and controlling terminals SHALL be read on those edges only and never on a timer. A bound session SHALL activate and acknowledge through exactly that terminal. A session bound to a terminal SHALL appear in that terminal's project even when its working directory is outside the project.

#### Scenario: Agent launched in a Terminay terminal

- **WHEN** a session's owning process is a descendant of a Terminay terminal's shell and has that terminal as its controlling terminal
- **THEN** the session is bound to that terminal and its tab shows the agent's status

#### Scenario: Two terminals in one directory

- **WHEN** two Terminay terminals in the same directory each run an agent
- **THEN** each session binds to the terminal whose process tree owns it, regardless of their shared working directory

#### Scenario: Bound agent changes directory

- **WHEN** a bound session reports a working directory outside its terminal's project
- **THEN** it remains bound and shown in its terminal's project

#### Scenario: Detached shared server started from a terminal

- **WHEN** a session's owning process is a detached background server that an agent in one terminal spawned, so it descends from that terminal's shell but has no controlling terminal
- **THEN** the session binds to no terminal and is shown as external, and that terminal's tab shows no status for it
