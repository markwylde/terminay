## ADDED Requirements

### Requirement: Manual update check

The desktop Help menu SHALL offer **Check for Updates…**. Choosing it SHALL
check the selected update channel immediately, regardless of when the last
check ran, and SHALL report the outcome in a native dialog once the check
settles. A manual check SHALL follow the same download, verification, and
installation rules as a scheduled check, and SHALL NOT install anything by
itself. The title-bar update action SHALL reflect the result of a manual check
as soon as it settles. Only the native menu SHALL be able to bypass the
scheduled pacing; a renderer SHALL NOT.

#### Scenario: Nothing newer

- **WHEN** the user chooses Check for Updates… and the channel has nothing newer
  than the running version
- **THEN** a dialog says Terminay is up to date and names the running version
  and channel

#### Scenario: Newer release found shortly after a scheduled check

- **WHEN** a scheduled check ran a minute ago and the user chooses Check for
  Updates… after a newer release was published
- **THEN** the release feed is checked again immediately
- **AND** a dialog names the newer version and says it is downloading
- **AND** the title-bar update action appears once the download is verified,
  without waiting for the next scheduled check

#### Scenario: Update already downloaded

- **WHEN** the user chooses Check for Updates… and a downloaded update is
  waiting and nothing newer exists
- **THEN** a dialog names that version and says it is ready to install

#### Scenario: Check fails

- **WHEN** the release feed is unreachable during a manual check
- **THEN** a dialog says the check failed and gives the reason
- **AND** the workspace is unaffected

#### Scenario: Check already running

- **WHEN** the user chooses Check for Updates… while a check is in flight
- **THEN** no second check starts and the dialog reports the running check's
  outcome
