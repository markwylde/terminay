## MODIFIED Requirements

### Requirement: Update availability checks

The desktop host SHALL check for a newer release of its selected update
channel when it starts and at least once an hour afterwards. When a build can
install updates in place, it SHALL download a newer release in the background
and surface it only once the download is complete and verified. When it cannot,
it SHALL surface that a newer release exists and link to its release page, and
download nothing. A failed check or download SHALL be reported without
disrupting the workspace, and SHALL be retried at the next check.

#### Scenario: Update available

- **WHEN** a packaged macOS build, a Linux build running from a writable
  AppImage, or a Windows build installed by the NSIS installer finds a newer
  release on its channel
- **THEN** the release is downloaded in the background without prompting
- **AND** the title-bar update action appears only after the download has been
  verified

#### Scenario: Update available on a build that cannot install in place

- **WHEN** an unpackaged build, or a Linux build that is not a writable
  AppImage, finds a newer release
- **THEN** the title-bar update action names the new version and opens its
  release page
- **AND** nothing is downloaded

#### Scenario: Check fails

- **WHEN** the release feed or a download is unreachable or malformed
- **THEN** no update action is shown for that attempt and the workspace is
  unaffected
- **AND** the next scheduled check tries again

### Requirement: Verified in-place update installation

A downloaded update SHALL be installed only after its SHA-512 digest matches
the digest in the channel's published update metadata. On macOS, the update
SHALL be installed only if its code signature satisfies the designated
requirement of the running application. Update metadata and payloads SHALL be
fetched over HTTPS from the project's GitHub releases only. On Windows, the
update SHALL be the NSIS installer named in the channel's metadata, run for the
current user without elevation and without asking where to install. It SHALL
install into the directory the running application was installed in, and it
SHALL NOT end terminals held by a session holder.

The title-bar action for a downloaded update SHALL read **Restart to update**
and name the version. Choosing it SHALL quit Terminay through the normal quit
path, install the update, and relaunch. A downloaded update that has not been
installed SHALL be installed when the user next quits Terminay.

#### Scenario: Restart to update

- **WHEN** the user chooses Restart to update
- **THEN** Terminay quits through its normal quit path, including any
  confirmation that path requires
- **AND** relaunches as the downloaded version

#### Scenario: Update installed on quit

- **WHEN** an update has been downloaded and the user quits Terminay without
  choosing Restart to update
- **THEN** the update is installed and the next launch runs the new version

#### Scenario: Digest mismatch

- **WHEN** a downloaded payload does not match the published SHA-512 digest
- **THEN** it is discarded, no update action is shown, and it is never
  installed

#### Scenario: Windows update with held terminals

- **WHEN** a Windows user with running terminals chooses Restart to update
- **THEN** the installer replaces the installation without a User Account
  Control prompt, Terminay relaunches as the new version, and the same
  terminals are still running with their output intact

## ADDED Requirements

### Requirement: Windows update metadata is published with the installer

A tag release that carries a Windows installer SHALL also carry `latest.yml`,
which names that installer, its size, and its SHA-512 digest. The `main`
prerelease SHALL carry `beta.yml` for its Windows installer in the same way.
Each metadata file SHALL be attached only after its installer and blockmap have
been uploaded, and with the same ordering guarantee as the macOS and Linux
metadata files.

#### Scenario: Stable Windows client checks

- **WHEN** a Windows build on the stable channel checks for updates after a
  tag release
- **THEN** it reads `latest.yml` from that release and finds the new installer

#### Scenario: Interrupted upload

- **WHEN** a release run fails after uploading the Windows installer and
  before attaching `latest.yml`
- **THEN** no Windows client is offered the incomplete release
