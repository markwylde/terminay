## ADDED Requirements

### Requirement: Isolated provider compatibility coverage
Provider registration SHALL have reproducible automated coverage for each supported provider
configuration format. Provider configuration replacement SHALL be atomic, SHALL preserve
existing modes, and SHALL refuse to replace a Terminay entry that has been changed outside
Terminay.

#### Scenario: Both provider formats
- **WHEN** the registration entry is serialized for each supported provider format
- **THEN** automated coverage validates the synthetic launch contract for both

#### Scenario: Changed Terminay entry
- **WHEN** installation would replace a Terminay entry that has been modified externally
- **THEN** the replacement is refused and the existing configuration is unchanged

### Requirement: MCP verification coverage
The MCP surface SHALL have reproducible automated coverage that launches a stdio entry
through the official MCP SDK and exercises more than one live project scope, with its
limitations stated explicitly.

#### Scenario: Official SDK stdio launch
- **WHEN** the verification suite runs
- **THEN** a test-built stdio entry is launched through the official MCP SDK
- **AND** two live project scopes are exercised for isolation

#### Scenario: Declared limitations
- **WHEN** the verification suite runs
- **THEN** it does not launch the synthetic persisted path, a packaged provider entry, or a developer's installed provider binary
- **AND** it does not modify real provider configuration
