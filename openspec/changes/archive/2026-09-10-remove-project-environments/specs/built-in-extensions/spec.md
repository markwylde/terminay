## ADDED Requirements

### Requirement: Agent extension composition with the server host

Agent extensions SHALL contribute agent providers only. At runtime they SHALL be
composed with the server host that owns a terminal, and that host SHALL supply
native observation for every terminal. Admission SHALL expose only the
observation the provider declared it uses.

#### Scenario: Agent composed with the server host

- **WHEN** an agent provider is admitted for a terminal
- **THEN** it is composed with the server host that owns that terminal and
  receives native observation

#### Scenario: Provider contributes only an agent provider

- **WHEN** an agent extension's manifest is validated
- **THEN** it contributes agent providers and no other provider kind

### Requirement: Disabling an agent extension is scoped to that extension

Disabling an agent extension SHALL immediately stop its new admissions and bounded observers. Existing canonical entries for that provider SHALL be retired and the terminal SHALL return to generic activity fallback. Disabling one agent extension SHALL NOT implicitly disable unrelated agent packages.

#### Scenario: Agent extension disabled

- **WHEN** a user disables an agent extension
- **THEN** new admissions and bounded observers stop immediately, existing canonical entries for that provider are retired, and affected terminals return to generic activity fallback

#### Scenario: Unrelated packages stay enabled

- **WHEN** a user disables one agent extension
- **THEN** unrelated agent packages remain enabled

## MODIFIED Requirements

### Requirement: Public API boundary for built-in extensions

Terminay's official extensions SHALL live as independently publishable npm packages under the repository's top-level `extensions/` directory. Codex, Claude Code, Grok, OpenCode, and omp SHALL use only the public `@terminay/extension-api`, and SHALL NOT import Server Core, Electron, renderer code, or private workspace modules. A repository boundary check SHALL fail when a built-in extension imports a private Terminay package or reaches a private source path. Public Node.js APIs and declared npm dependencies SHALL be valid extension implementation dependencies.

#### Scenario: Private import introduced

- **WHEN** a built-in extension imports a private Terminay package or reaches a private source path
- **THEN** the repository boundary check fails

#### Scenario: Permitted dependencies

- **WHEN** a built-in extension uses public Node.js APIs and its declared npm dependencies
- **THEN** the boundary check passes

### Requirement: Package identity and repository participation

Each directory below `extensions/` SHALL be one npm package with its own `package.json`, manifest, source, tests, README, licence, build output policy, and public-package conformance checks. `extensions/agent-codex` SHALL publish `terminay-agent-codex`; `extensions/agent-claude-code` SHALL publish `terminay-agent-claude-code`; `extensions/agent-grok` SHALL publish `terminay-agent-grok`; and `extensions/agent-omp` SHALL publish `terminay-agent-omp`. The directories SHALL participate in the repository's npm workspace graph while remaining packable and testable as ordinary public npm projects. Their runtime dependency on `@terminay/extension-api` SHALL follow the public peer and development dependency convention. Published packages SHALL contain no workspace-relative imports or undeclared files and SHALL pass conformance against their packed tarball.

#### Scenario: Packing a built-in package

- **WHEN** a built-in extension package is packed
- **THEN** the tarball contains no workspace-relative imports or undeclared files and passes conformance

#### Scenario: Workspace participation

- **WHEN** the repository workspace graph is resolved
- **THEN** each `extensions/` package participates while remaining independently packable and testable

### Requirement: Agent extension package documentation

The package README for every agent extension SHALL document the supported CLI and provider versions; foreground-process recognition and exact terminal-binding evidence; provider-owned files and bounded fields it reads; canonical lifecycle, model, title, tool, wait, and subagent mappings; privacy exclusions and information that never crosses the extension host; unsupported provider behaviour and fallback behaviour; platform assumptions; and fixture, compatibility, and real-CLI verification commands.

#### Scenario: Reviewing an agent package README

- **WHEN** a reader opens an agent extension's README
- **THEN** it documents supported CLI and provider versions, foreground-process recognition and terminal-binding evidence, provider-owned files and bounded fields, canonical lifecycle/model/title/tool/wait/subagent mappings, privacy exclusions, unsupported and fallback behaviour, platform assumptions, and verification commands

### Requirement: First-run materialization

On first start, the server SHALL materialize the release's verified artifacts into server-owned slots and SHALL record their origin as `built-in`. Materialization SHALL be idempotent and crash-safe. A clean Electron or standalone-server installation SHALL expose all five built-ins without npm or network access.

#### Scenario: Clean installation

- **WHEN** a clean Electron or standalone server starts for the first time
- **THEN** all five built-ins are materialized from verified release artifacts without npm or network access

#### Scenario: Interrupted materialization

- **WHEN** materialization is interrupted and the server restarts
- **THEN** materialization completes idempotently without corrupt slots

### Requirement: Failed built-in isolation and presentation

An incompatible or failed built-in SHALL be represented like any other failed extension and SHALL NOT prevent the server or unrelated extensions from becoming ready. Dependent extensions SHALL show the ordinary dependency failure. Built-in extensions SHALL appear once in Settings with a **Built in** and **Official** origin, and SHALL NOT appear as duplicate catalogue and installed entries.

#### Scenario: Incompatible built-in

- **WHEN** a built-in is incompatible or fails to activate
- **THEN** the server and unrelated extensions still become ready and dependent extensions show the ordinary dependency failure

#### Scenario: Settings listing

- **WHEN** a user views Settings
- **THEN** each built-in appears exactly once, marked **Built in** and **Official**

## REMOVED Requirements

### Requirement: Agent extension composition with project environments

**Reason:** Project environments are removed; every terminal runs on the server that owns it, so there is no environment to compose with and no capability subset to advertise. Replaced by "Agent extension composition with the server host".

**Migration:** None; there are no installed users. Reaching another machine means running a Terminay Server on it and connecting to it.

### Requirement: Disabling an agent extension

**Reason:** Its dependency clause and scenario covered disabling the SSH or Puzed environment extensions, which are removed with the project environment layer. Replaced by "Disabling an agent extension is scoped to that extension".

**Migration:** None; there are no installed users.
