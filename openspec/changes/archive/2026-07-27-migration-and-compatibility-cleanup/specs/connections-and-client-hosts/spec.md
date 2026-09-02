## ADDED Requirements

### Requirement: Manager profile migration and credential isolation

Sanitized manager metadata SHALL be moved or redirected from the legacy manager origin to its replacement origin without copying cross-origin credentials. Existing session origins and their valid reconnect grants SHALL be preserved, so a migrated grant reloads unchanged and completes a fresh challenge and proof. Desktop connection profiles SHALL migrate separately from server trust state. A non-canonical profile URL SHALL be rejected, trust and profile outputs SHALL omit credential-bearing fields, and pairing fragments and credentials SHALL NOT enter either manager origin.

#### Scenario: Credentials do not cross origins

- **WHEN** manager metadata is migrated to the replacement origin
- **THEN** no cross-origin credential is copied and no pairing fragment enters either manager origin

#### Scenario: Reconnect grant survives migration

- **WHEN** a migrated profile with a valid reconnect grant reconnects
- **THEN** the origin-bound grant reloads unchanged and completes a fresh challenge and proof

#### Scenario: Non-canonical profile URL is rejected

- **WHEN** a migrated profile carries a non-canonical URL
- **THEN** it is rejected rather than imported

### Requirement: Minimum versions and precise incompatibility errors

Desktop, server, bundled UI, bootstrap, and signaling SHALL each declare a minimum supported version. An incompatibility SHALL be reported as a deterministic, precise error naming the incompatible component, and SHALL be reported before migration or backup begins. Hosted deployment SHALL be ordered so that a hosted compatibility window covers currently deployed and dependent client versions; client publication or hosted retirement before hosted publication and verification SHALL be rejected.

#### Scenario: Incompatibility precedes migration

- **WHEN** a component is below its declared minimum version
- **THEN** a deterministic minimum-version error is reported before migration or backup begins

#### Scenario: Deployment ordering is enforced

- **WHEN** a client publication or a hosted retirement is attempted before hosted publication and verification
- **THEN** it is rejected

### Requirement: Credential-free recovery client

The server-bundled UI reached directly SHALL remain available as a recovery client. Its fallback metadata SHALL be explicit and credential-free, so recovery never depends on manager-origin state or on a stored credential.

#### Scenario: Recovery without the manager

- **WHEN** the connection manager is unavailable or a migration has failed
- **THEN** the server-bundled UI can still be reached directly using explicit credential-free fallback metadata

### Requirement: Narrow versioned Desktop host bridges

Every native Desktop behaviour SHALL be exposed through its own frozen, versioned host that validates its exact message shape, bounded identities, and size limits before delivering anything to the renderer. There SHALL be no broad application preload object and no generic application IPC marker. A renderer or adapter SHALL receive its host capability explicitly at a named composition boundary and SHALL snapshot it into an immutable wrapper, so importing a module cannot acquire ambient host authority and cannot observe a later replacement of a host method. Zero-consumer operations SHALL be removed from the public host surface.

#### Scenario: Malformed native message is refused

- **WHEN** a native host receives a malformed or unbounded presentation message
- **THEN** it is rejected before reaching the renderer

#### Scenario: Importing a module grants no host authority

- **WHEN** a renderer module is imported without being given a host capability
- **THEN** it has no ambient host access and fails closed

#### Scenario: No broad preload object remains

- **WHEN** the packaged preload surface is inspected
- **THEN** no broad application object or generic application IPC marker is present

### Requirement: Retired remote and compatibility paths stay out of production

The retired Electron WebRTC host, the terminal-only remote protocol, its services, and its client page SHALL be absent from every normal Desktop workspace entry and from the static web build. Remaining compatibility imports SHALL be inventoried as exact directed edges; only the renderer-entry hand-off, named transitional callers, and the canonical transport bridge may reach legacy or disconnected modules, and any new edge SHALL fail until it is removed or explicitly classified. Packaged Local and remote windows SHALL launch the selected server's verified bundle over its identity-bound byte endpoint.

#### Scenario: Retired remote client is not shipped

- **WHEN** the static web build is produced
- **THEN** the terminal-only remote client page and its protocol are absent

#### Scenario: New compatibility edge fails

- **WHEN** a new import edge into a legacy or disconnected module appears
- **THEN** the boundary check fails until the edge is removed or explicitly classified

#### Scenario: Packaged window launches the verified bundle

- **WHEN** a packaged Local or remote window opens
- **THEN** it launches the selected server's verified bundle over its identity-bound byte endpoint
