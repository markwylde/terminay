## ADDED Requirements

### Requirement: Independent canonical-forge desktop releases

The canonical forge SHALL offer a manually dispatched Trigger Release workflow that builds macOS arm64 and Linux x64 desktop binaries from one immutable commit, with a stable vMAJOR.MINOR.PATCH tag derived automatically using the same Conventional Commit version rules as GitHub. It SHALL NOT obtain binaries from GitHub or require a Windows runner.

#### Scenario: Independent release

- **WHEN** an operator dispatches Trigger Release on main without inputs
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

### Requirement: Automatic version selection and repeat dispatches

The workflow SHALL reuse the repository release-version helper to select major, minor or patch versions from commits since the latest stable tag. A stable tag already at the selected source commit SHALL be reused to resume its workflow-owned draft. A workflow-owned release already published for that commit SHALL make a repeat dispatch succeed without rebuilding or mutating it.

#### Scenario: Feature commit

- **WHEN** commits since v1.2.3 include a feature and no breaking change
- **THEN** the workflow selects v1.3.0 without operator version input

#### Scenario: Retrying a draft

- **WHEN** a prior attempt tagged the selected source commit and left a matching draft
- **THEN** the workflow selects that same tag and resumes the draft

#### Scenario: Already published

- **WHEN** the selected source commit already has its workflow-owned published release
- **THEN** release preparation succeeds and dependent build and publication jobs are skipped

### Requirement: Generated release notes

Canonical-forge releases SHALL generate AI notes using the shared GitHub generator and prompt before dependency installation, verification suites or platform builds. The configured OPENROUTER_API_KEY SHALL be exercised in that preflight. Missing credentials or generation failures SHALL stop preparation without starting builds. Successful notes SHALL be saved in the workflow-owned draft and used unchanged at publication, preserving source revision and update-feed information. Blank or missing saved notes SHALL prevent publication.

#### Scenario: AI notes available

- **WHEN** AI generation succeeds during preparation
- **THEN** the draft stores the generated Markdown and publication uses that content without requesting AI generation again

#### Scenario: Credential rejected

- **WHEN** OpenRouter rejects the credential or AI generation otherwise fails
- **THEN** the preparation job fails before dependency installation or platform builds

#### Scenario: Missing notes

- **WHEN** the publisher has no non-empty saved release notes
- **THEN** the release remains a draft
