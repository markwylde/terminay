## MODIFIED Requirements

### Requirement: Self-contained sterile npm installer

Every server distribution SHALL include an extension installer built from npm's
package libraries, installed as ordinary dependencies of the server so that every
package in the installer's dependency tree is recorded in the repository lockfile
and is reachable by its dependency overrides and release audit. Distributions
SHALL NOT include the npm command-line program. Extension support MUST NOT depend
on a system Node, npm, compiler, shell profile, or user configuration. The
installer SHALL run in a bounded child process through a sterile Terminay-owned
configuration fixed to the public npmjs registry and a private directory under
the server data root, and MUST NOT inherit the user's `.npmrc`, tokens,
workspace, lifecycle policy, proxy credentials, or project working directory.
When the server is embedded in Desktop, the installer child process SHALL run
through the Electron executable with `ELECTRON_RUN_AS_NODE=1`, and installing an
extension MUST NOT launch another Desktop application instance or window.

#### Scenario: User npm configuration present

- **WHEN** the user has an `.npmrc` with tokens and an alternate registry
- **THEN** installation ignores it and uses the sterile Terminay-owned
  configuration fixed to public npmjs

#### Scenario: Installing under Desktop

- **WHEN** an extension is installed on a Desktop-embedded server
- **THEN** the installer child process runs with `ELECTRON_RUN_AS_NODE=1` and no
  second Desktop instance or window appears

#### Scenario: Installer dependencies are audited like any other

- **WHEN** the release supply-chain audit runs
- **THEN** every package in the installer's dependency tree is checked from the
  repository lockfile with its own integrity record, and none is exempted as
  bundled inside another package

#### Scenario: No npm program in a distribution

- **WHEN** a Desktop or standalone server artifact is inspected
- **THEN** it contains no npm command-line program and extension installation
  still succeeds

### Requirement: Installation failure, cleanup, and receipts

Failure SHALL leave the prior active version untouched. Staging SHALL be
recoverably cleaned or quarantined after interruption. Receipts SHALL record safe
package, version, registry integrity, lock and inventory hashes, installer
version, permissions, compatibility, and advisory audit and provenance status.

#### Scenario: Interrupted install

- **WHEN** an install is interrupted
- **THEN** the prior active version is untouched and the staging slot is
  recoverably cleaned or quarantined

#### Scenario: Receipt contents

- **WHEN** an install completes
- **THEN** its receipt records package, version, registry integrity, lock and
  inventory hashes, installer version, permissions, compatibility, and advisory
  audit and provenance status
