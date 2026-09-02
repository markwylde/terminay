## ADDED Requirements

### Requirement: Environment-scoped catalogues and launch resolution
Shell discovery, the profile catalogue, default profile selection, home and working-directory
resolution, path validation, and the final launch environment SHALL be resolved for the
project's canonical environment. Catalogue responses SHALL redact environment values.

#### Scenario: Catalogue reflects the environment
- **WHEN** a client requests the shell catalogue for a project on a non-local environment
- **THEN** the catalogue lists shells discovered on that environment, with environment values
  redacted

#### Scenario: Working directory validated on the target
- **WHEN** a terminal is created with a working directory
- **THEN** that directory is validated on the project's environment before spawn, and an
  invalid directory fails the launch rather than falling back to the server host
