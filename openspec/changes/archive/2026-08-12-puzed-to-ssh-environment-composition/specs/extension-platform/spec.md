## MODIFIED Requirements

### Requirement: Disable, uninstall, and retention

Disable SHALL preserve profiles, environment records, data, and secret
references. Uninstall SHALL be blocked while the extension is enabled, referenced
by profiles or projects, required by another extension, or in use. Code removal
MUST NOT cascade-delete projects, external resources, credentials, or provider
data. An installed official version MAY be disabled and retained as a rollback
floor under the same slot-retention policy as a custom extension. A
release-bundled slot SHALL be an immutable rollback floor: it MAY be disabled or
superseded by a compatible external slot but MUST NOT be physically removed from
that release.

#### Scenario: Uninstall blocked

- **WHEN** the user uninstalls an extension that is enabled, referenced, required
  by another extension, or in use
- **THEN** the uninstall is blocked and its dependants are listed

#### Scenario: Disabled provider projects

- **WHEN** a provider is disabled or incompatible
- **THEN** its projects remain represented and never fall back to Local

#### Scenario: Release-bundled slot removal

- **WHEN** removal of a release-bundled slot is attempted
- **THEN** it is refused; the slot may only be disabled or superseded

### Requirement: Extension dependencies are distinct from npm dependencies

Extension dependencies SHALL be distinct from npm library dependencies. A
dependent extension SHALL declare a compatible extension dependency and call its
public provider contract; it MUST NOT import the other extension's internals,
duplicate its transport, or silently install another extension without
administrator confirmation.

#### Scenario: Puzed depends on SSH

- **WHEN** Puzed requires SSH functionality
- **THEN** it declares a compatible SSH extension dependency and calls its public
  provider contract without importing SSH internals

#### Scenario: Implicit dependency install

- **WHEN** installing an extension would require installing another extension
- **THEN** it is not installed silently without administrator confirmation
