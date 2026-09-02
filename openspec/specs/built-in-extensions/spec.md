# built-in-extensions Specification

## Purpose

Terminay ships its official extensions — SSH, Puzed, Codex, Claude Code, Cursor Agent, Grok, and omp — as independently publishable npm packages that use only the public Extension API. Every server release contains verified, self-contained artifacts for them so a fresh server materializes and enables them without network access.

## Requirements

### Requirement: Public API boundary for built-in extensions

Terminay's official extensions SHALL live as independently publishable npm packages under the repository's top-level `extensions/` directory. SSH, Puzed, Codex, Claude Code, Cursor Agent, Grok, and omp SHALL use only the public `@terminay/extension-api`, and SHALL NOT import Server Core, Electron, renderer code, or private workspace modules. A repository boundary check SHALL fail when a built-in extension imports a private Terminay package or reaches a private source path. Public Node.js APIs and declared npm dependencies SHALL be valid extension implementation dependencies.

#### Scenario: Private import introduced

- **WHEN** a built-in extension imports a private Terminay package or reaches a private source path
- **THEN** the repository boundary check fails

#### Scenario: Permitted dependencies

- **WHEN** a built-in extension uses public Node.js APIs and its declared npm dependencies
- **THEN** the boundary check passes

### Requirement: Built-in status is a distribution property

Built-in status SHALL describe distribution, not a more privileged runtime tier. Users SHALL be able to disable any built-in extension.

#### Scenario: Runtime privileges compared

- **WHEN** a built-in extension runs alongside an externally installed extension
- **THEN** both run under the same permissions and runtime tier

#### Scenario: Disabling a built-in

- **WHEN** a user disables a built-in extension
- **THEN** the extension is disabled

### Requirement: Package identity and repository participation

Each directory below `extensions/` SHALL be one npm package with its own `package.json`, manifest, source, tests, README, licence, build output policy, and public-package conformance checks. `extensions/ssh` SHALL publish `terminay-plugin-ssh`; `extensions/puzed` SHALL publish `terminay-plugin-puzed`; `extensions/agent-codex` SHALL publish `terminay-agent-codex`; `extensions/agent-claude-code` SHALL publish `terminay-agent-claude-code`; `extensions/agent-cursor` SHALL publish `terminay-agent-cursor`; `extensions/agent-grok` SHALL publish `terminay-agent-grok`; and `extensions/agent-omp` SHALL publish `terminay-agent-omp`. The directories SHALL participate in the repository's npm workspace graph while remaining packable and testable as ordinary public npm projects. Their runtime dependency on `@terminay/extension-api` SHALL follow the public peer and development dependency convention. Published packages SHALL contain no workspace-relative imports or undeclared files and SHALL pass conformance against their packed tarball.

#### Scenario: Packing a built-in package

- **WHEN** a built-in extension package is packed
- **THEN** the tarball contains no workspace-relative imports or undeclared files and passes conformance

#### Scenario: Workspace participation

- **WHEN** the repository workspace graph is resolved
- **THEN** each `extensions/` package participates while remaining independently packable and testable

### Requirement: Agent extension package documentation

The package README for every agent extension SHALL document the supported CLI and provider versions; foreground-process recognition and exact terminal-binding evidence; provider-owned files and bounded fields it reads; canonical lifecycle, model, title, tool, wait, and subagent mappings; privacy exclusions and information that never crosses the extension host; unsupported provider behaviour and fallback behaviour; platform assumptions and environment capabilities; and fixture, compatibility, and real-CLI verification commands.

#### Scenario: Reviewing an agent package README

- **WHEN** a reader opens an agent extension's README
- **THEN** it documents supported CLI and provider versions, foreground-process recognition and terminal-binding evidence, provider-owned files and bounded fields, canonical lifecycle/model/title/tool/wait/subagent mappings, privacy exclusions, unsupported and fallback behaviour, platform assumptions, and verification commands

### Requirement: Agent packages as reference implementations

The five agent packages SHALL be the reference implementations for third-party agent integration. Their tests and source SHALL use only the installed public SDK surface.

#### Scenario: Agent package tests

- **WHEN** an agent package's tests and source are built
- **THEN** they compile and run against only the installed public SDK surface

### Requirement: Release artifact inventory

The release build SHALL pack each built-in extension and its production dependency closure into a deterministic artifact inventory. The inventory SHALL record extension id, npm package name, and exact version; manifest and Extension API compatibility; package and unpacked-file digests; production dependency lock and inventory digests; permissions and contributions; and the release identity that contains the artifact.

#### Scenario: Building a release

- **WHEN** the release build packs the built-in extensions
- **THEN** the inventory records extension id, package name, exact version, manifest and API compatibility, package and unpacked-file digests, dependency lock and inventory digests, permissions and contributions, and the containing release identity

### Requirement: Identical artifacts across distributions

The same inventory format and package bytes SHALL be used by the Electron and standalone Terminay Server archives. Release assembly SHALL fail when a built-in is missing, stale, non-conformant, contains an unapproved native or lifecycle requirement, differs between server distributions, or imports a private API. No build SHALL silently fetch a built-in extension from npm.

#### Scenario: Distribution drift

- **WHEN** the built-in package bytes or inventory differ between the Electron and standalone archives
- **THEN** release assembly fails

#### Scenario: Non-conformant or stale built-in

- **WHEN** a built-in is missing, stale, non-conformant, carries an unapproved native or lifecycle requirement, or imports a private API
- **THEN** release assembly fails

#### Scenario: No implicit npm fetch

- **WHEN** a release is built
- **THEN** no built-in extension is silently fetched from npm

### Requirement: Built-ins use the ordinary extension runtime

Built-ins SHALL use the normal immutable extension-slot format, public manifest validation, extension host, IPC protocol, permissions, crash isolation, and compatibility checks.

#### Scenario: Loading a built-in

- **WHEN** a built-in extension is loaded
- **THEN** it passes the same manifest validation, permission model, IPC protocol, crash isolation, and compatibility checks as any other extension

### Requirement: First-run materialization

On first start, the server SHALL materialize the release's verified artifacts into server-owned slots and SHALL record their origin as `built-in`. Materialization SHALL be idempotent and crash-safe. A clean Electron or standalone-server installation SHALL expose all seven built-ins without npm or network access.

#### Scenario: Clean installation

- **WHEN** a clean Electron or standalone server starts for the first time
- **THEN** all seven built-ins are materialized from verified release artifacts without npm or network access

#### Scenario: Interrupted materialization

- **WHEN** materialization is interrupted and the server restarts
- **THEN** materialization completes idempotently without corrupt slots

### Requirement: Default enablement and persistent user choice

Every built-in SHALL be enabled by default unless the server already has an explicit user choice for that extension id. Disablement SHALL persist across application and server upgrades. A release MAY provide a newer built-in slot, but startup SHALL NOT silently re-enable an extension, change an explicitly selected external version, or hot-swap a slot beneath a live provider.

#### Scenario: Default enablement

- **WHEN** a server has no explicit choice for a built-in extension id
- **THEN** that extension is enabled by default

#### Scenario: Disabled built-in after upgrade

- **WHEN** a user disables a built-in and then upgrades the application or server
- **THEN** the extension remains disabled

#### Scenario: Newer slot on startup

- **WHEN** a release provides a newer built-in slot
- **THEN** startup does not silently re-enable the extension, change an explicitly selected external version, or hot-swap the slot beneath a live provider

### Requirement: Live reconciliation

Reconciliation SHALL be a supported live server lifecycle. If a verified release artifact materializes an enabled active built-in after the extension manager is already running, the server SHALL activate that exact slot before it reports reconciliation complete. Provider and agent-provider contributions SHALL become visible together only after that host is running. A failed activation SHALL be recorded as that extension's explicit failed runtime state, and the UI SHALL NOT call an enabled-but-unhosted record `installed`. Reconciliation SHALL NOT restart an unchanged running provider and SHALL NOT swap a selected override beneath an active use.

#### Scenario: Artifact materializes while running

- **WHEN** a verified release artifact materializes an enabled active built-in after the extension manager is running
- **THEN** the server activates that exact slot before reporting reconciliation complete
- **AND** provider and agent-provider contributions become visible together once the host is running

#### Scenario: Activation fails

- **WHEN** activating a reconciled built-in fails
- **THEN** the extension is recorded in an explicit failed runtime state and is not shown as `installed`

#### Scenario: Unchanged provider

- **WHEN** reconciliation encounters an unchanged running provider or a selected override in active use
- **THEN** it neither restarts the provider nor swaps the override

### Requirement: Bundled slot as a rollback floor

The immutable artifact shipped with the current release SHALL NOT be physically removable through extension management. A user SHALL be able to disable it, install and select a compatible newer npm version, roll back to the release artifact, or remove the external override. Removing an override SHALL return to the bundled slot while preserving the user's enabled or disabled choice.

#### Scenario: Attempting to remove a built-in

- **WHEN** a user attempts to remove the bundled artifact through extension management
- **THEN** the removal is refused and disable, override, and rollback remain available

#### Scenario: Removing an npm override

- **WHEN** a user removes an installed npm override
- **THEN** the extension returns to the bundled slot with the user's enabled or disabled choice preserved

### Requirement: Failed built-in isolation and presentation

An incompatible or failed built-in SHALL be represented like any other failed extension and SHALL NOT prevent **This server** or unrelated extensions from becoming ready. Dependent extensions SHALL show the ordinary dependency failure. Built-in extensions SHALL appear once in Settings with a **Built in** and **Official** origin, and SHALL NOT appear as duplicate catalogue and installed entries.

#### Scenario: Incompatible built-in

- **WHEN** a built-in is incompatible or fails to activate
- **THEN** **This server** and unrelated extensions still become ready and dependent extensions show the ordinary dependency failure

#### Scenario: Settings listing

- **WHEN** a user views Settings
- **THEN** each built-in appears exactly once, marked **Built in** and **Official**

### Requirement: Agent extension composition with project environments

Agent extensions SHALL contribute agent providers and SHALL NOT contribute project environments. At runtime they SHALL be composed with the exact project environment that owns a terminal, and the environment SHALL supply only the observation capabilities it actually implements. **This server** SHALL supply native local observation, and SSH or another provider MAY supply equivalent remote observation. Local admission SHALL expose only the capabilities that provider declared, even when **This server** offers additional observation capabilities.

#### Scenario: Agent on a remote environment

- **WHEN** an agent provider is composed with an SSH or other remote project environment
- **THEN** it receives only the observation capabilities that environment implements

#### Scenario: Declared capability limit

- **WHEN** an agent provider is admitted locally
- **THEN** only the capabilities that provider declared are exposed, even where **This server** offers more

### Requirement: Disabling an agent extension

Disabling an agent extension SHALL immediately stop its new admissions and bounded observers. Existing canonical entries for that provider SHALL be retired and the terminal SHALL return to generic activity fallback. Disabling SSH or Puzed SHALL affect their environments through the existing dependency and in-use rules and SHALL NOT implicitly disable unrelated agent packages.

#### Scenario: Agent extension disabled

- **WHEN** a user disables an agent extension
- **THEN** new admissions and bounded observers stop immediately, existing canonical entries for that provider are retired, and affected terminals return to generic activity fallback

#### Scenario: Disabling an environment extension

- **WHEN** a user disables SSH or Puzed
- **THEN** their environments follow the existing dependency and in-use rules and unrelated agent packages remain enabled

### Requirement: Re-evaluation when an agent host becomes available

When a newly reconciled agent host becomes available, Terminay SHALL re-evaluate the last host-observed foreground executable for every live terminal. A newly matching provider SHALL be admitted without restarting the terminal, and a non-matching terminal SHALL remain on generic activity.

#### Scenario: New agent host activates

- **WHEN** a newly reconciled agent host becomes available
- **THEN** each live terminal's last host-observed foreground executable is re-evaluated

#### Scenario: Newly matching provider

- **WHEN** re-evaluation finds a matching provider for a live terminal
- **THEN** the provider is admitted without restarting the terminal

#### Scenario: No match

- **WHEN** re-evaluation finds no matching provider
- **THEN** the terminal remains on generic activity

### Requirement: Built-in extension acceptance outcomes

Installing or removing an npm override SHALL preserve a verified bundled rollback floor and the explicit enablement choice. Every built-in package SHALL pack, test, and typecheck using only `@terminay/extension-api` and its declared npm dependencies. Agent packages SHALL be disableable independently without removing the Agents pane or breaking generic terminal activity.

#### Scenario: Override lifecycle

- **WHEN** a user installs and then removes an npm override for a built-in
- **THEN** the verified bundled rollback floor and the explicit enablement choice are preserved

#### Scenario: Package verification

- **WHEN** a built-in package is packed, tested, and typechecked
- **THEN** it succeeds using only `@terminay/extension-api` and its declared npm dependencies

#### Scenario: Independent agent disablement

- **WHEN** one agent package is disabled
- **THEN** the Agents pane remains and generic terminal activity continues

### Requirement: Packaged runtime activation of built-in agent extensions

A packaged Electron application and a packaged standalone Terminay Server SHALL activate every staged built-in extension from their own packaged resource root rather than from a development staging directory or repository source. A packaged runtime SHALL admit an agent terminal and reduce that provider's canonical lifecycle through the packaged extension host. The packaged lifecycle matrix SHALL cover offline first run, restart, persisted disablement, a compatible npm override, rollback and removal to the bundled floor, and corrupted-artifact failure isolation. Packaging SHALL regenerate stale staged artifacts rather than accepting a stale staging directory.

#### Scenario: Packaged resource root activation

- **WHEN** a packaged Electron or standalone server starts
- **THEN** every built-in extension activates from that distribution's packaged resource root

#### Scenario: Agent admission in a packaged runtime

- **WHEN** an agent CLI runs in a terminal of a packaged runtime
- **THEN** the packaged extension host admits it and its canonical provider lifecycle is reduced in the agent store

#### Scenario: Stale staged artifacts

- **WHEN** packaging finds staged built-in artifacts that no longer match their sources
- **THEN** the artifacts are regenerated before the package is produced

#### Scenario: Packaged lifecycle matrix

- **WHEN** the packaged lifecycle matrix runs
- **THEN** offline first run, restart, persisted disablement, compatible override, rollback to the bundled floor, and corrupted-artifact isolation all behave as specified

### Requirement: Supported-architecture release verification

Built-in extension artifacts SHALL be verified on the declared supported distribution matrix: Terminay Desktop on macOS arm64 and GNU/Linux x64, and standalone Terminay Server on GNU/Linux x64 and arm64. Verification SHALL run from a clean dependency install, SHALL assert the runtime and machine architecture it claims to prove, and SHALL NOT accept an emulated build as evidence for an architecture it did not natively execute. The Electron resource inventory and the standalone payload inventory SHALL be byte-identical.

#### Scenario: Architecture assertion

- **WHEN** a packaged built-in lifecycle job runs on a release runner
- **THEN** it asserts the runtime and machine architecture before running the offline lifecycle check

#### Scenario: Emulated build

- **WHEN** an architecture is exercised only through emulation
- **THEN** the run is not accepted as evidence for that architecture

#### Scenario: Inventory parity

- **WHEN** the Electron and standalone inventories for one release are compared
- **THEN** they are byte-identical and rehash to the same built-in packages

### Requirement: Development staging and admission of built-in extensions

The development launch path SHALL stage the packed built-in artifacts before Electron starts, SHALL use the selected development resource root rather than an installed-app resource root for staging and discovery, and SHALL recover when the development artifact directory is absent. A development run SHALL be able to admit a real agent CLI in the selected project's terminal, publish its canonical root, later children, and live title changes, and render them in the Agents sidebar. A stale installed or failed extension record for a built-in id SHALL NOT mask a newly materialized bundled floor. Ordinary startup failures SHALL remain visible as startup failures and SHALL NOT be classified as canonical persisted-workspace recovery.

#### Scenario: Development pre-stage

- **WHEN** the development command launches Electron
- **THEN** the packed built-ins are staged from the development resource root beforehand, and an absent artifact directory is recovered rather than fatal

#### Scenario: Development agent admission

- **WHEN** a supported agent CLI runs in a development run's selected terminal
- **THEN** its canonical root, later child sessions, and live title changes appear in the Agents sidebar

#### Scenario: Stale failed record

- **WHEN** a stale installed or failed extension record exists for a built-in id
- **THEN** it does not mask the newly materialized bundled floor

#### Scenario: Startup failure classification

- **WHEN** an ordinary startup failure occurs
- **THEN** it is reported as a startup failure rather than as persisted-workspace recovery
