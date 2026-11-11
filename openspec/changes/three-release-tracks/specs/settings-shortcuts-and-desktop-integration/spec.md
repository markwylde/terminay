## MODIFIED Requirements

### Requirement: Release notes for an available update

When an update is available, the user SHALL be able to open a **What's new**
dialog from the update action. On the stable channel, the dialog SHALL list the
release notes of every stable release newer than the installed version, up to
and including the available one, newest first, each headed by its version and
linking to its release page. On the Nightly and Canary channels, it SHALL show
the notes published with the available build and SHALL name the build's track.
Release notes SHALL be rendered from Markdown into sanitized HTML with no
script, no inline event handlers, no remote resource loads, and links that open
in the system browser.

#### Scenario: Several releases behind

- **WHEN** the installed version is two stable releases behind the available
  one
- **THEN** What's new shows both releases' notes, newest first

#### Scenario: Canary build available

- **WHEN** a Canary installation is offered a canary build
- **THEN** What's new shows the notes published with that build and names it a
  canary build

#### Scenario: Notes cannot be fetched

- **WHEN** the release notes cannot be retrieved
- **THEN** the dialog says so and links to the release page, and the update
  can still be installed

### Requirement: Updates declare the oldest system they run on

Every macOS update metadata file Terminay publishes, on every channel, SHALL declare the oldest macOS the update runs on, as the Darwin kernel version electron-updater compares with the running system. Publication SHALL fail when that declaration is missing or differs from the supported matrix's macOS floor. A Desktop running on a system below an update's declared floor SHALL keep its installed version, SHALL NOT download or install that update, and SHALL NOT show an update action for it.

#### Scenario: Mac below the floor

- **WHEN** a Desktop on a Mac older than the update's declared floor checks for updates
- **THEN** it does not download or install that update and keeps running its installed version

#### Scenario: Mac at or above the floor

- **WHEN** a Desktop on a supported macOS checks for an update that declares the floor
- **THEN** it updates as it would for any other update

#### Scenario: Metadata without the floor

- **WHEN** a stable, nightly or canary job produces macOS update metadata without the floor, or with a different floor
- **THEN** publication fails before the metadata becomes visible to installed clients

## ADDED Requirements

### Requirement: Update channel selection

Update channel SHALL be a device setting with the values **Stable** (the
default), **Nightly** and **Canary**. Stable follows tagged releases. Nightly
follows the rolling nightly prerelease, built once a night from `main`. Canary
follows the rolling canary prerelease, built on every push to `main`. The
setting SHALL say that Canary builds are the least tested. Changing the channel
SHALL take effect at the next check, which starts immediately. Changing channel
SHALL NOT install a lower version than the one running; the installation stays
where it is until its new channel publishes something newer. A stored value
that is not one of the three SHALL be read as Stable.

#### Scenario: Opt in to nightly

- **WHEN** the user selects the Nightly update channel
- **THEN** an update check against the rolling nightly prerelease starts
  immediately

#### Scenario: Opt in to canary

- **WHEN** the user selects the Canary update channel
- **THEN** an update check against the rolling canary prerelease starts
  immediately

#### Scenario: Return to stable from a newer prerelease

- **WHEN** a Nightly or Canary installation running a version newer than the
  latest stable release switches to Stable
- **THEN** no update is offered until a stable release newer than the running
  version is published

#### Scenario: Move from nightly to canary

- **WHEN** a Nightly installation running `6.3.0-main.3300.nightly` switches to
  Canary and the canary prerelease is `6.3.0-main.3312.canary`
- **THEN** `6.3.0-main.3312.canary` is offered

#### Scenario: Move from canary to nightly

- **WHEN** a Canary installation running `6.3.0-main.3312.canary` switches to
  Nightly and the nightly prerelease is `6.3.0-main.3300.nightly`
- **THEN** no update is offered until a Nightly built from that commit or a
  later one is published

#### Scenario: Unknown stored value

- **WHEN** the stored update channel is not Stable, Nightly or Canary
- **THEN** the setting reads Stable

### Requirement: Prerelease channels follow stable releases

On the Nightly and Canary update channels, an update check SHALL consider both
the channel's own rolling prerelease and the latest stable release, and SHALL
offer whichever has the higher version by semantic-version precedence, provided
it is newer than the running version. A Nightly installation SHALL NOT read the
canary prerelease, and a Canary installation SHALL NOT read the nightly
prerelease. A stable release offered on a prerelease channel SHALL be
downloaded, verified, and installed exactly as it is on the Stable channel; its
What's new SHALL list the stable release notes newer than the installed version,
and its release link SHALL open the tagged release page. Offering a stable
release SHALL NOT change the update channel setting. When only one of the two
sources can be read, the check SHALL proceed with that source; the check fails
only when neither can be read.

#### Scenario: Stable release newer than the latest nightly

- **WHEN** a Nightly installation runs `5.8.0-main.3290.nightly`, the rolling
  nightly prerelease is `5.8.0-main.3300.nightly`, and the latest stable
  release is 5.8.0
- **THEN** 5.8.0 is offered
- **AND** What's new shows the stable release notes and links to the 5.8.0
  release page

#### Scenario: Canary newer than the latest stable release

- **WHEN** the rolling canary prerelease is `5.9.0-main.3320.canary` and the
  latest stable release is 5.8.0
- **THEN** a Canary installation is offered `5.9.0-main.3320.canary` with the
  notes published with that build

#### Scenario: Nightly resumes after a stable release

- **WHEN** a Nightly installation running stable 5.8.0 checks after the nightly
  prerelease publishes `5.9.0-main.3330.nightly`
- **THEN** `5.9.0-main.3330.nightly` is offered
- **AND** the update channel setting is still Nightly

#### Scenario: Neither source is newer

- **WHEN** both the channel's rolling prerelease and the latest stable release
  are at or below the running version
- **THEN** no update is offered and nothing is downloaded

#### Scenario: One source unreachable

- **WHEN** the stable release metadata cannot be read and the channel's rolling
  prerelease is newer than the running version
- **THEN** the rolling prerelease is offered
- **AND** the check is not reported as failed

#### Scenario: Canary does not read nightly

- **WHEN** a Canary installation checks for updates
- **THEN** it reads the canary prerelease and the latest stable release, and
  not the nightly prerelease

#### Scenario: Both sources unreachable

- **WHEN** neither source can be read
- **THEN** the check is reported as failed without disrupting the workspace and
  is retried at the next check

## REMOVED Requirements

### Requirement: Update channel setting

**Reason**: The Beta channel is replaced by Nightly and Canary, so the setting's values and every scenario change. "Update channel selection" states the three-value setting.

**Migration**: A stored Beta value is read as Nightly. Installed Beta builds receive Nightly builds on the feed they already read and move to Nightly on first launch.

### Requirement: Beta channel follows stable releases

**Reason**: There is no Beta channel. "Prerelease channels follow stable releases" states the same rule for Nightly and Canary.

**Migration**: None for users; Nightly and Canary follow stable releases exactly as Beta did.
