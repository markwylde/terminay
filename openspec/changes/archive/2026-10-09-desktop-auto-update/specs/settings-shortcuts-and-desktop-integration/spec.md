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

- **WHEN** a packaged macOS build, or a Linux build running from a writable
  AppImage, finds a newer release on its channel
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

## ADDED Requirements

### Requirement: Verified in-place update installation

A downloaded update SHALL be installed only after its SHA-512 digest matches
the digest in the channel's published update metadata. On macOS, the update
SHALL be installed only if its code signature satisfies the designated
requirement of the running application. Update metadata and payloads SHALL be
fetched over HTTPS from the project's GitHub releases only.

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

### Requirement: Release notes for an available update

When an update is available, the user SHALL be able to open a **What's new**
dialog from the update action. On the stable channel, the dialog SHALL list the
release notes of every stable release newer than the installed version, up to
and including the available one, newest first, each headed by its version and
linking to its release page. On the beta channel, it SHALL show the notes
published with the available beta build. Release notes SHALL be rendered from
Markdown into sanitized HTML with no script, no inline event handlers, no
remote resource loads, and links that open in the system browser.

#### Scenario: Several releases behind

- **WHEN** the installed version is two stable releases behind the available
  one
- **THEN** What's new shows both releases' notes, newest first

#### Scenario: Notes cannot be fetched

- **WHEN** the release notes cannot be retrieved
- **THEN** the dialog says so and links to the release page, and the update
  can still be installed

### Requirement: Update channel setting

Update channel SHALL be a device setting with the values **Stable** (the
default) and **Beta**. Stable follows tagged releases. Beta follows the rolling
`main` prerelease, whose versions are the next stable version with a `beta`
prerelease component. Changing the channel SHALL take effect at the next check,
which starts immediately. Changing channel SHALL NOT install a lower version
than the one running; the installation stays where it is until its new channel
publishes something newer.

#### Scenario: Opt in to beta

- **WHEN** the user selects the Beta update channel
- **THEN** an update check against the rolling `main` prerelease starts
  immediately

#### Scenario: Return to stable from a newer beta

- **WHEN** a Beta installation running a version newer than the latest stable
  release switches to Stable
- **THEN** no update is offered until a stable release newer than the running
  version is published
