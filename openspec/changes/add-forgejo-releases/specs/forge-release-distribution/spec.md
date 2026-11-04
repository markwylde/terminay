## ADDED Requirements

### Requirement: Independent canonical-forge desktop releases

The canonical forge SHALL offer a manually dispatched Trigger Release workflow that builds macOS arm64 and Linux x64 desktop binaries from one immutable commit, with a stable vMAJOR.MINOR.PATCH tag supplied by the operator. It SHALL NOT obtain binaries from GitHub or require a Windows runner.

#### Scenario: Independent release

- **WHEN** an operator dispatches a stable version on main
- **THEN** both desktop platforms build from the selected commit and release assets are attached to that tag on the canonical forge

#### Scenario: Conflicting tag

- **WHEN** the requested tag identifies a different commit
- **THEN** the workflow fails without changing the tag or publishing a release

### Requirement: Verified complete publication

The workflow SHALL verify macOS signing, notarization and packaged startup, and Linux glibc-floor compatibility and terminal execution. It SHALL publish only after both platform jobs succeed and the full expected asset set and SHA-256 sidecars downloaded from the draft verify. A retry SHALL reuse an existing draft only for the same commit and SHALL reject different bytes under an existing asset name. Published releases SHALL be immutable to the workflow.

#### Scenario: Build failure

- **WHEN** either platform build or verification fails
- **THEN** the release remains a draft

#### Scenario: Complete release

- **WHEN** all expected downloaded payloads match their checksum sidecars after both builds succeed
- **THEN** the release is published with source revision and download notes

### Requirement: Independent GitHub release behaviour

GitHub SHALL retain its existing release workflow including Windows binaries and remain the desktop application update source. Canonical-forge releases SHALL NOT mutate GitHub releases or publish Windows assets.

#### Scenario: Canonical-forge release

- **WHEN** the canonical-forge workflow runs
- **THEN** GitHub release workflows and application update configuration retain their existing behaviour
