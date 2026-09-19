## MODIFIED Requirements

### Requirement: Public API boundary for built-in extensions

Terminay's official extensions SHALL live as independently publishable npm packages under the repository's top-level `extensions/` directory. The built-in agents extension and the TypeScript language extension SHALL use only the public `@terminay/extension-api`. They SHALL NOT import Server Core, Electron, renderer code, or private workspace modules. A repository boundary check SHALL fail when a built-in extension imports a private Terminay package or reaches a private source path. Public Node.js APIs and declared npm dependencies, native ones included, SHALL be valid extension implementation dependencies.

#### Scenario: Private import introduced

- **WHEN** a built-in extension imports a private Terminay package or reaches a private source path
- **THEN** the repository boundary check fails

#### Scenario: Permitted dependencies

- **WHEN** a built-in extension uses public Node.js APIs and its declared npm dependencies
- **THEN** the boundary check passes

### Requirement: Package identity and repository participation

Each directory below `extensions/` SHALL be one npm package with its own `package.json`, manifest, source, tests, README, licence, build output policy, and public-package conformance checks. `extensions/builtin-agents` SHALL publish `terminay-builtin-agents` under the extension id `com.terminay.builtin-agents`. `extensions/language-typescript` SHALL publish `terminay-language-typescript` under the extension id `com.terminay.language.typescript`. The directories SHALL participate in the repository's npm workspace graph while remaining packable and testable as ordinary public npm projects. Their runtime dependency on `@terminay/extension-api` SHALL follow the public peer and development dependency convention. Published packages SHALL contain no workspace-relative imports or undeclared files and SHALL pass conformance against their packed tarball.

#### Scenario: Packing a built-in package

- **WHEN** a built-in extension package is packed
- **THEN** the tarball contains no workspace-relative imports or undeclared files and passes conformance

#### Scenario: Workspace participation

- **WHEN** the repository workspace graph is resolved
- **THEN** each `extensions/` package participates while remaining independently packable and testable

#### Scenario: Built-in agents package identity

- **WHEN** the built-in agents extension is resolved
- **THEN** `extensions/builtin-agents` publishes `terminay-builtin-agents` under the extension id `com.terminay.builtin-agents`

#### Scenario: TypeScript language package identity

- **WHEN** the TypeScript language extension is resolved
- **THEN** `extensions/language-typescript` publishes `terminay-language-typescript` under the extension id `com.terminay.language.typescript`

### Requirement: Agent extension package documentation

The README of the built-in agents extension SHALL document:

- the harnesses it reports and the pinned `@markwylde/all-your-agents` version
- that version's capability matrix and stated limitations
- the per-harness switches
- the bounded snapshot fields that cross the extension boundary, and the privacy exclusions
- the MCP install targets and the configuration file each one changes
- platform assumptions, including the optional native process-watch dependency
- its test commands

#### Scenario: Reviewing an agent package README

- **WHEN** a reader opens the built-in agents extension's README
- **THEN** it documents the harnesses, pinned library version and capability matrix, per-harness switches, snapshot fields and privacy exclusions, MCP install targets and their files, platform assumptions, and test commands

### Requirement: Agent packages as reference implementations

The built-in agents extension SHALL be the reference implementation for a session source and for MCP install targets. Its tests and source SHALL use only the installed public SDK surface.

#### Scenario: Agent package tests

- **WHEN** the built-in agents package's tests and source are built
- **THEN** they compile and run against only the installed public SDK surface

### Requirement: Identical artifacts across distributions

The same inventory format and package bytes SHALL be used by the Electron and standalone Terminay Server archives, for every built-in. Release assembly SHALL fail when a built-in:

- is missing, stale, or non-conformant
- requires an install lifecycle script
- carries a native module with no prebuilt binary for one of the supported distribution targets
- differs between server distributions
- imports a private API

No build SHALL silently fetch a built-in extension from npm.

#### Scenario: Distribution drift

- **WHEN** the built-in package bytes or inventory differ between the Electron and standalone archives
- **THEN** release assembly fails

#### Scenario: Non-conformant or stale built-in

- **WHEN** a built-in is missing, stale, non-conformant, requires an install lifecycle script, or imports a private API
- **THEN** release assembly fails

#### Scenario: Native dependency for the target

- **WHEN** a built-in's production closure includes a native module with prebuilt binaries for every supported distribution target
- **THEN** release assembly accepts it, records it in the inventory, and ships the same bytes in every distribution

#### Scenario: No implicit npm fetch

- **WHEN** a release is built
- **THEN** no built-in extension is silently fetched from npm

### Requirement: First-run materialization

On first start, the server SHALL materialize the release's verified artifacts into server-owned slots and SHALL record their origin as `built-in`. Materialization SHALL be idempotent and crash-safe. A clean Electron or standalone-server installation SHALL expose both built-ins, `terminay-builtin-agents` and `terminay-language-typescript`, without npm or network access.

#### Scenario: Clean installation

- **WHEN** a clean Electron or standalone server starts for the first time
- **THEN** the built-in agents and TypeScript language extensions are materialized from verified release artifacts without npm or network access

#### Scenario: Interrupted materialization

- **WHEN** materialization is interrupted and the server restarts
- **THEN** materialization completes idempotently without corrupt slots

### Requirement: Re-evaluation when an agent host becomes available

When a session source becomes available — a newly reconciled or re-enabled host, or a harness switched on — it SHALL report every session live at that moment. Terminay SHALL bind each one to the terminal whose process tree owns it without restarting any terminal. Terminals owning no reported session SHALL remain on generic activity.

#### Scenario: New agent host activates

- **WHEN** a session source becomes available while an agent already runs in a Terminay terminal
- **THEN** that session is reported and bound to its terminal without restarting the terminal

#### Scenario: Newly matching provider

- **WHEN** a harness is switched on while its CLI already runs in a Terminay terminal
- **THEN** its session is reported and bound to that terminal without restarting the terminal

#### Scenario: No match

- **WHEN** a terminal owns no reported session
- **THEN** it remains on generic activity

### Requirement: Built-in extension acceptance outcomes

Installing or removing an npm override SHALL preserve a verified bundled rollback floor and the explicit enablement choice. Every built-in package SHALL pack, test, and typecheck using only `@terminay/extension-api` and its declared npm dependencies. Switching off one harness, or disabling the agents extension, SHALL NOT remove the Agents pane or break generic terminal activity.

#### Scenario: Override lifecycle

- **WHEN** a user installs and then removes an npm override for a built-in
- **THEN** the verified bundled rollback floor and the explicit enablement choice are preserved

#### Scenario: Package verification

- **WHEN** a built-in package is packed, tested, and typechecked
- **THEN** it succeeds using only `@terminay/extension-api` and its declared npm dependencies

#### Scenario: Independent agent disablement

- **WHEN** one harness is switched off
- **THEN** the Agents pane remains and generic terminal activity continues

### Requirement: Packaged runtime activation of built-in agent extensions

A packaged Electron application and a packaged standalone Terminay Server SHALL activate every staged built-in extension from their own packaged resource root, not from a development staging directory or repository source. A packaged runtime SHALL receive session snapshots from the packaged built-in agents extension, including its native process-watch dependency where the platform provides one, and SHALL reduce them in the agent store. The packaged lifecycle matrix SHALL cover:

- offline first run
- restart
- persisted disablement
- a compatible npm override
- rollback and removal to the bundled floor
- corrupted-artifact failure isolation

Packaging SHALL regenerate stale staged artifacts rather than accept a stale staging directory.

#### Scenario: Packaged resource root activation

- **WHEN** a packaged Electron or standalone server starts
- **THEN** every built-in extension activates from that distribution's packaged resource root

#### Scenario: Agent admission in a packaged runtime

- **WHEN** a fixture agent session is live on the machine of a packaged runtime
- **THEN** the packaged built-in agents extension reports it and it is reduced in the agent store

#### Scenario: Stale staged artifacts

- **WHEN** packaging finds staged built-in artifacts that no longer match their sources
- **THEN** the artifacts are regenerated before the package is produced

#### Scenario: Packaged lifecycle matrix

- **WHEN** the packaged lifecycle matrix runs
- **THEN** offline first run, restart, persisted disablement, compatible override, rollback to the bundled floor, and corrupted-artifact isolation all behave as specified

### Requirement: Development staging and admission of built-in extensions

The development launch path SHALL stage the packed built-in artifacts before Electron starts. It SHALL use the selected development resource root, not an installed-app resource root, for staging and discovery, and SHALL recover when the development artifact directory is absent. A development run SHALL show a real agent CLI running in the selected project's terminal in the Agents sidebar with its root, subagents, and live title changes. A stale installed or failed extension record for a built-in id SHALL NOT mask a newly materialized bundled floor. Ordinary startup failures SHALL remain visible as startup failures and SHALL NOT be classified as canonical persisted-workspace recovery.

#### Scenario: Development pre-stage

- **WHEN** the development command launches Electron
- **THEN** the packed built-ins are staged from the development resource root beforehand, and an absent artifact directory is recovered rather than fatal

#### Scenario: Development agent admission

- **WHEN** a supported agent CLI runs in a development run's selected terminal
- **THEN** its root, subagents, and live title changes appear in the Agents sidebar

#### Scenario: Stale failed record

- **WHEN** a stale installed or failed extension record exists for a built-in id
- **THEN** it does not mask the newly materialized bundled floor

#### Scenario: Startup failure classification

- **WHEN** an ordinary startup failure occurs
- **THEN** it is reported as a startup failure rather than as persisted-workspace recovery

### Requirement: Agent extension composition with the server host

The built-in agents extension SHALL contribute one session source and the MCP install targets for the agent clients it knows. At runtime its session source SHALL be composed with the server host that owns the project and terminal state. That host SHALL perform all project scoping and terminal binding.

#### Scenario: Agent composed with the server host

- **WHEN** the built-in agents extension activates
- **THEN** its session source publishes to the server host that owns project and terminal state, and that host alone scopes and binds sessions

#### Scenario: Provider contributes only an agent provider

- **WHEN** the built-in agents extension's manifest is validated
- **THEN** it contributes a session source and MCP install targets and no other kind

### Requirement: Disabling an agent extension is scoped to that extension

Disabling the built-in agents extension SHALL stop its session source immediately, retire every entry it published, and return affected terminals to generic activity fallback. It SHALL also make its MCP install targets unavailable. Switching off one harness SHALL retire only that harness's entries and stop reporting it, leaving the other harnesses unchanged. Disabling one extension SHALL NOT disable another.

#### Scenario: Agent extension disabled

- **WHEN** a user disables the built-in agents extension
- **THEN** its source stops, its entries are retired, affected terminals return to generic activity, and its MCP install targets become unavailable

#### Scenario: One harness switched off

- **WHEN** a user switches off the Grok harness
- **THEN** Grok entries are retired and no longer reported, and Claude Code, Codex, and oh-my-pi entries are unchanged

#### Scenario: Unrelated packages stay enabled

- **WHEN** a user disables the built-in agents extension
- **THEN** the TypeScript language extension and every other extension remain enabled
