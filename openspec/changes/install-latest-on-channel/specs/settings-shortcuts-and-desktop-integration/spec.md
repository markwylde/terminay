## ADDED Requirements

### Requirement: Install the latest build on the selected channel

The Desktop Updates page SHALL show an **Install latest on <channel>** action,
naming the selected update channel, wherever Terminay Desktop can update itself
in place. The action SHALL name the channel's latest version. On Stable, that
is the latest stable release. On Nightly or Canary, it is whichever of the
channel's rolling prerelease and the latest stable release is higher, as an
update check resolves it. The action SHALL be shown even when that version is
older than the running build. When it equals the running build, the action
SHALL be shown disabled, with the statement that this build is already the
latest on the channel. A development build SHALL show the action disabled,
with the reason that it has no release version.

Choosing the action SHALL open a confirmation that names the running version
and the target version. When the target is older, the confirmation SHALL say so
and SHALL warn that settings and state written by the running build might not
carry over. Nothing SHALL be downloaded until the user confirms. After
confirmation, Terminay SHALL download the target build and show its progress.
Before installing it, Terminay SHALL verify the build exactly as an ordinary
update, then restart into it without the application close confirmation,
keeping retained terminal sessions running.

Only this action SHALL install an older build. Automatic checks, the update
notice, Help > Check for Updates…, and changing the update channel SHALL never
install or offer a build older than the running one.

#### Scenario: Back to stable from a nightly build

- **WHEN** a Desktop running `6.3.0-main.3300.nightly` is on the Stable channel,
  the latest stable release is `6.2.4`, and the user chooses Install latest on
  Stable and confirms
- **THEN** the confirmation names `6.3.0-main.3300.nightly` and `6.2.4` and
  warns that this is an older build
- **AND** Terminay downloads `6.2.4`, verifies it, and relaunches as `6.2.4`

#### Scenario: Newer build on the channel

- **WHEN** a Desktop on Stable runs `6.2.3` and the latest stable release is
  `6.2.4`
- **THEN** Install latest on Stable names `6.2.4` and its confirmation shows no
  downgrade warning

#### Scenario: Already the latest

- **WHEN** the running build is the channel's latest version
- **THEN** the action is shown disabled and says this build is already the
  latest on the channel

#### Scenario: Cancel

- **WHEN** the user dismisses the confirmation
- **THEN** nothing is downloaded and the running build is unchanged

#### Scenario: Switching channel alone never downgrades

- **WHEN** a Desktop running a Nightly build newer than the latest stable
  release switches to Stable and the user does not choose Install latest
- **THEN** no update is offered or installed

#### Scenario: Verification fails

- **WHEN** the downloaded build does not match its published SHA-512 digest
- **THEN** it is discarded, Terminay does not restart, and the Updates page
  reports the failure
