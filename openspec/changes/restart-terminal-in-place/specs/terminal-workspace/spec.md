## ADDED Requirements

### Requirement: Restart a terminal in place

A terminal panel SHALL offer a **Restart terminal** action, also shown on a
degraded terminal's banner, that ends the panel's shell and starts a new one in
the same panel. The panel keeps its position, name, project, folder, working
directory and shell profile. The action is allowed only to a caller that may
both close that terminal and open a terminal in its project, and is refused if
the panel no longer holds the session the caller named.

#### Scenario: A degraded terminal is restarted

- **WHEN** the user chooses **Restart terminal** on a terminal whose temporary
  directory is no longer usable
- **THEN** the same panel shows a new shell with the same name, project and
  working directory
- **AND** the new shell can create a directory in its temporary directory
- **AND** the degraded banner is gone

#### Scenario: The panel was rebound before the restart arrived

- **WHEN** a restart names a session that the panel no longer holds
- **THEN** the restart is refused and no shell is ended

#### Scenario: The new shell cannot start

- **WHEN** a restart ends the old shell and the new shell fails to start
- **THEN** the panel shows the start failure with a retry
- **AND** no session record is left for the old shell
