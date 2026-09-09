## MODIFIED Requirements
### Requirement: Public API boundary for built-in extensions

Terminay's official extensions SHALL live as independently publishable npm packages under the repository's top-level `extensions/` directory. SSH, Puzed, Codex, Claude Code, Grok, OpenCode, and omp SHALL use only the public `@terminay/extension-api`, and SHALL NOT import Server Core, Electron, renderer code, or private workspace modules. A repository boundary check SHALL fail when a built-in extension imports a private Terminay package or reaches a private source path. Public Node.js APIs and declared npm dependencies SHALL be valid extension implementation dependencies.

#### Scenario: Private import introduced

- **WHEN** a built-in extension imports a private Terminay package or reaches a private source path
- **THEN** the repository boundary check fails

#### Scenario: Permitted dependencies

- **WHEN** a built-in extension uses public Node.js APIs and its declared npm dependencies
- **THEN** the boundary check passes

### Requirement: Package identity and repository participation

Each directory below `extensions/` SHALL be one npm package with its own `package.json`, manifest, source, tests, README, licence, build output policy, and public-package conformance checks. `extensions/ssh` SHALL publish `terminay-plugin-ssh`; `extensions/puzed` SHALL publish `terminay-plugin-puzed`; `extensions/agent-codex` SHALL publish `terminay-agent-codex`; `extensions/agent-claude-code` SHALL publish `terminay-agent-claude-code`; `extensions/agent-grok` SHALL publish `terminay-agent-grok`; and `extensions/agent-omp` SHALL publish `terminay-agent-omp`. The directories SHALL participate in the repository's npm workspace graph while remaining packable and testable as ordinary public npm projects. Their runtime dependency on `@terminay/extension-api` SHALL follow the public peer and development dependency convention. Published packages SHALL contain no workspace-relative imports or undeclared files and SHALL pass conformance against their packed tarball.

#### Scenario: Packing a built-in package

- **WHEN** a built-in extension package is packed
- **THEN** the tarball contains no workspace-relative imports or undeclared files and passes conformance

#### Scenario: Workspace participation

- **WHEN** the repository workspace graph is resolved
- **THEN** each `extensions/` package participates while remaining independently packable and testable
