## ADDED Requirements

### Requirement: Beta channel follows stable releases

On the Beta update channel, an update check SHALL consider both the rolling
`main` prerelease and the latest stable release, and SHALL offer whichever has
the higher version by semantic-version precedence, provided it is newer than
the running version. A stable release offered on the Beta channel SHALL be
downloaded, verified, and installed exactly as it is on the Stable channel; its
What's new SHALL list the stable release notes newer than the installed version,
and its release link SHALL open the tagged release page. Offering a stable
release SHALL NOT change the update channel setting. When only one of the two
sources can be read, the check SHALL proceed with that source; the check fails
only when neither can be read.

#### Scenario: Stable release newer than the latest beta

- **WHEN** a Beta installation runs 5.8.0-beta.14, the rolling prerelease is
  5.8.0-beta.15, and the latest stable release is 5.8.0
- **THEN** 5.8.0 is offered
- **AND** What's new shows the stable release notes and links to the 5.8.0
  release page

#### Scenario: Beta newer than the latest stable release

- **WHEN** the rolling prerelease is 5.9.0-beta.3 and the latest stable release
  is 5.8.0
- **THEN** 5.9.0-beta.3 is offered with the notes published with that beta build

#### Scenario: Beta resumes after a stable release

- **WHEN** a Beta installation running stable 5.8.0 checks after `main`
  publishes 5.9.0-beta.1
- **THEN** 5.9.0-beta.1 is offered
- **AND** the update channel setting is still Beta

#### Scenario: Neither source is newer

- **WHEN** both the rolling prerelease and the latest stable release are at or
  below the running version
- **THEN** no update is offered and nothing is downloaded

#### Scenario: One source unreachable

- **WHEN** the stable release metadata cannot be read and the rolling
  prerelease is newer than the running version
- **THEN** the rolling prerelease is offered
- **AND** the check is not reported as failed

#### Scenario: Both sources unreachable

- **WHEN** neither source can be read
- **THEN** the check is reported as failed without disrupting the workspace and
  is retried at the next check
