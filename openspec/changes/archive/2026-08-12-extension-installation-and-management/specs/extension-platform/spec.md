## ADDED Requirements

### Requirement: Self-contained sterile npm installer
Every supported server artifact — Desktop-embedded, standalone x64, standalone arm64, and
Docker — SHALL ship a pinned npm installer. Extension installation SHALL NOT require a system
npm, a compiler, or any other host toolchain.

#### Scenario: Host without npm
- **WHEN** an extension is installed on a server whose host has no npm or compiler installed
- **THEN** the installation completes using the packaged pinned installer

### Requirement: Install from npm
Installation SHALL resolve only from the public npmjs registry. Alias, git, file, URL, and
custom-registry specifiers SHALL be rejected. A resolved package SHALL have an exact version, an
exact lock, and integrity metadata; a package missing integrity SHALL be rejected.

#### Scenario: Non-npmjs specifier
- **WHEN** a dependency specifier names an alias, git, file, URL, or custom registry
- **THEN** the install is rejected before any package is staged

#### Scenario: Missing integrity
- **WHEN** a resolved package has no integrity metadata
- **THEN** the install is rejected

### Requirement: Transactional installation pipeline
Installation SHALL follow resolve, preview, confirm, staged materialization, and atomic
activation into an immutable slot, and SHALL write a receipt for the outcome. Package scripts
SHALL be disabled during staging. The dependency tree SHALL be validated within bounds, and
native, build, or install-script trees, bad symlinks, and bad entrypoints SHALL be rejected
before activation.

#### Scenario: Scripts never run
- **WHEN** a package or any dependency declares an install script or a native build step
- **THEN** it is rejected before activation and no script is executed

#### Scenario: Atomic activation
- **WHEN** activation runs
- **THEN** the new immutable slot becomes active in one step and a receipt records the outcome

### Requirement: Installation failure, cleanup, and receipts
A failed or interrupted installation or update SHALL leave the active version unchanged. Crash
recovery SHALL restore a consistent state on the next start, and abandoned staging material
SHALL be cleaned up. Every attempt SHALL be recorded in a receipt.

#### Scenario: Interrupted install
- **WHEN** the server is interrupted part way through an install or update
- **THEN** the previously active version remains active and recovery cleans up the abandoned slot

### Requirement: Side-by-side updates
An update SHALL be staged side-by-side with the active version, and the switch SHALL drain and
restart the extension rather than mutating the active slot in place.

#### Scenario: Update switch
- **WHEN** an update is activated
- **THEN** the new slot is staged alongside the current one and the extension is drained and restarted onto it

### Requirement: Rollback slots
The server SHALL retain a known-good slot and SHALL allow rollback by selecting that exact
retained slot. Rollback SHALL NOT revert external actions the extension has already performed.

#### Scenario: Rollback to known good
- **WHEN** rollback is requested after a bad update
- **THEN** the exact retained known-good slot becomes active

#### Scenario: External effects not reverted
- **WHEN** rollback completes
- **THEN** actions the extension already performed outside the server are unchanged and this limit is stated

### Requirement: Disable, uninstall, and retention
Extension states SHALL include installed, disabled, incompatible, failed, quarantined, and
pending. Enable, disable, and remove SHALL be reference-aware. Removal SHALL NOT cascade into
deleting projects, project environment profiles, secrets, or external resources. Extension data
SHALL be snapshotted under the extension's own namespace.

#### Scenario: Referenced extension removal
- **WHEN** removal is requested for an extension that projects still reference
- **THEN** the blocking references are reported and no project, profile, secret, or external resource is deleted

#### Scenario: Namespaced data snapshot
- **WHEN** an extension is removed or updated
- **THEN** its data is snapshotted under its own namespace

### Requirement: Official catalogue and release-bundled artifacts
The official catalogue SHALL be hardcoded records for the official SSH and Puzed extensions.
Installing an official extension SHALL resolve its exact npmjs version and integrity through the
same preview and install path as any other package. When the registry is unreachable, the surface
SHALL present an actionable offline or registry-unavailable state.

#### Scenario: Official install uses the ordinary path
- **WHEN** an official catalogue entry is installed
- **THEN** its exact npmjs version and integrity are resolved through the ordinary preview and install path

#### Scenario: Registry unreachable
- **WHEN** the npmjs registry cannot be reached
- **THEN** an actionable offline or registry-unavailable state is presented rather than a silent failure

### Requirement: Advisory signature and provenance reporting
Signature, provenance, and audit results SHALL be reported as informational metadata only, and a
trusted-code warning SHALL be shown before installing a custom package.

#### Scenario: Custom package warning
- **WHEN** a custom package is reviewed for installation
- **THEN** signature and provenance results are shown as informational metadata and the trusted-code warning is displayed

### Requirement: Custom installation review and confirmation
Only a manager SHALL be able to install, update, roll back, disable, or remove an extension.
Browser and Desktop hosts SHALL NOT store any extension package.

#### Scenario: Non-manager mutation
- **WHEN** a non-manager attempts an extension mutation
- **THEN** the request is refused

#### Scenario: Hosts store no package
- **WHEN** an extension is installed on the selected server
- **THEN** no package content is stored by the browser or Desktop host
