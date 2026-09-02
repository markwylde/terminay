## ADDED Requirements

### Requirement: Install from an uploaded package file
The selected Terminay Server SHALL accept one npm-pack `.tgz` archive through a
bounded binary application-protocol command and SHALL return an exact expiring
preview of the extension it contains. Install and update confirmation SHALL be
bound to that archive's integrity. The archive SHALL be uploaded to the
currently selected server; neither a renderer path nor package bytes may be
persisted in client state.

#### Scenario: Unpublished provider install
- **WHEN** an administrator uploads an `npm pack` archive for an unpublished
  provider and confirms the preview
- **THEN** the extension is installed without the root package being published

#### Scenario: Preview expiry and integrity binding
- **WHEN** confirmation arrives after the preview expires, or for an archive
  whose integrity does not match the preview
- **THEN** the installation is refused

#### Scenario: No package bytes in client state
- **WHEN** client state is inspected after an upload
- **THEN** it contains neither the package bytes nor a renderer filesystem path

### Requirement: Archive inspection fails closed
Archive structure and manifest SHALL be inspected before confirmation.
Traversal entries, links, malformed archives, oversized archives, and identity
drift between the preview and the confirmed archive SHALL be rejected. A failed
installation MUST NOT change the active extension pointer or execute extension
lifecycle code.

#### Scenario: Hostile archive
- **WHEN** an uploaded archive contains a path-traversal entry or a link
- **THEN** it is rejected before materialization

#### Scenario: Failure leaves the prior state
- **WHEN** an uploaded-package installation fails at any stage
- **THEN** the active extension pointer is unchanged, staging is cleaned, and
  no lifecycle code has run

### Requirement: Dependency resolution for uploaded packages
The uploaded root archive SHALL be materialized with install scripts disabled.
All transitive dependency resolution SHALL remain integrity-pinned to public
npmjs.

#### Scenario: Scripts disabled
- **WHEN** an uploaded root archive declares install lifecycle scripts
- **THEN** they are not executed during materialization

#### Scenario: Pinned transitive dependencies
- **WHEN** the uploaded package declares dependencies
- **THEN** they are resolved from public npmjs with integrity pinning, not from
  the upload

### Requirement: Uploaded package labelling
An extension installed from an uploaded package file SHALL be presented as
uploaded and unverified, including when its name matches an official catalogue
entry. Extensions Settings SHALL offer **Install package file…** on Desktop and
browser hosts with actionable errors.

#### Scenario: Spoofed official name
- **WHEN** an uploaded package declares the name of an official catalogue entry
- **THEN** it remains visibly uploaded and unverified

#### Scenario: Entry point available on both hosts
- **WHEN** Extensions Settings is opened on a Desktop or browser host
- **THEN** **Install package file…** is available and reports upload failures
  with actionable errors
