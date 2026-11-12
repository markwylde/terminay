## MODIFIED Requirements

### Requirement: Version reference resolution

`daemon install` and `daemon upgrade` SHALL accept an optional reference. With no reference, `install` SHALL resolve the latest tagged release. A reference of the form `vX.Y.Z` SHALL resolve that tag; `main` SHALL resolve the rolling nightly prerelease; `canary` SHALL resolve the rolling canary prerelease; any other branch name or commit SHALL resolve to a source build of that ref. Resolution SHALL select the archive matching the host architecture and SHALL fail with a clear message when the release exists but lacks an archive for that architecture.

#### Scenario: Latest tag

- **WHEN** `daemon install` runs with no reference
- **THEN** the newest tagged release's archive for the host architecture is selected

#### Scenario: Explicit tag

- **WHEN** `daemon install v4.0.0` runs
- **THEN** the archive attached to release `v4.0.0` for the host architecture is selected

#### Scenario: Main channel

- **WHEN** `daemon install main` runs
- **THEN** the archive attached to the nightly prerelease for the host architecture is selected

#### Scenario: Canary channel

- **WHEN** `daemon install canary` runs
- **THEN** the archive attached to the canary prerelease for the host architecture is selected

#### Scenario: Branch or commit

- **WHEN** `daemon install <branch-or-commit>` runs
- **THEN** the CLI resolves it to a source build of that ref

#### Scenario: Missing architecture

- **WHEN** the resolved release has no archive for the host architecture
- **THEN** the command fails and names the architecture and release

## ADDED Requirements

### Requirement: A canary install follows the canary channel

`daemon upgrade` with no reference on a `canary` install SHALL upgrade to the newest canary revision, deciding by the revision recorded in the signed manifest as a `main` install does. `daemon status` SHALL report the channel of a canary install as `canary`. A canary install SHALL move to another channel only when a reference names it.

#### Scenario: Follow the canary channel

- **WHEN** a `canary` install runs `daemon upgrade` and the canary prerelease has a newer revision
- **THEN** that revision is installed and becomes current

#### Scenario: Nothing newer

- **WHEN** a `canary` install runs `daemon upgrade` and the canary prerelease is the installed revision
- **THEN** nothing is installed and the command says the install is current

#### Scenario: Leave canary

- **WHEN** a `canary` install runs `daemon upgrade main`
- **THEN** the nightly archive is installed and the install's channel becomes `main`
