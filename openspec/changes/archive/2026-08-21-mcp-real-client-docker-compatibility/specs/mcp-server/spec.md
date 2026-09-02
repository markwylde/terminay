## ADDED Requirements

### Requirement: Isolated real-client compatibility coverage

Provider registration compatibility SHALL be proven against the real supported
agent client binaries, installed from their current published releases, inside
an isolated container. The run SHALL use a container-only home directory and a
harmless local stdio command, and SHALL NOT mount or forward the host home,
provider credentials, or provider configuration. Each client's own MCP
management surface SHALL report the Terminay registration. The run SHALL require
no authentication, model request, or host provider state, and SHALL be a
required continuous-integration job whose isolation and workflow wiring are
themselves covered by a contract test.

#### Scenario: Every client recognises the registration

- **WHEN** the Terminay provider registry installs its user-scope registrations
  in the container home
- **THEN** each supported client's MCP listing reports the Terminay registration

#### Scenario: The host is never consulted

- **WHEN** the compatibility run executes
- **THEN** no host home directory, provider credential, or provider
  configuration is mounted or forwarded

#### Scenario: Contract drift fails identifiably

- **WHEN** a provider changes its configuration contract so a client no longer
  recognises the registration
- **THEN** the job fails, naming the client and including bounded command output
