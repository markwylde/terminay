# built-in-extensions Specification

## Purpose

Terminay ships its official extensions — Codex, Claude Code, Grok, OpenCode, omp, and TypeScript — as independently publishable npm packages that use only the public Extension API. Every server release contains verified, self-contained artifacts for them so a fresh server materializes and enables them without network access.

## Requirements

### Requirement: Public API boundary for built-in extensions

Terminay's official extensions SHALL live as independently publishable npm packages under the repository's top-level `extensions/` directory. The built-in agents extension and the TypeScript language extension SHALL use only the public `@terminay/extension-api`. They SHALL NOT import Server Core, Electron, renderer code, or private workspace modules. A repository boundary check SHALL fail when a built-in extension imports a private Terminay package or reaches a private source path. Public Node.js APIs and declared npm dependencies, native ones included, SHALL be valid extension implementation dependencies.

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

### Requirement: Release artifact inventory

The release build SHALL pack each built-in extension and its production dependency closure into a deterministic artifact inventory. `terminay-language-typescript` SHALL be one of the packed built-ins, and its bundled TypeScript and language server SHALL be part of its production dependency closure. The inventory SHALL record extension id, npm package name, and exact version; manifest and Extension API compatibility; package and unpacked-file digests; production dependency lock and inventory digests; permissions and contributions; and the release identity that contains the artifact.

#### Scenario: Building a release

- **WHEN** the release build packs the built-in extensions
- **THEN** the inventory records extension id, package name, exact version, manifest and API compatibility, package and unpacked-file digests, dependency lock and inventory digests, permissions and contributions, and the containing release identity

#### Scenario: TypeScript language extension in the inventory

- **WHEN** the release build packs the built-in extensions
- **THEN** `terminay-language-typescript` appears in the inventory with its bundled TypeScript and language server inside its recorded production dependency closure

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

### Requirement: Built-ins use the ordinary extension runtime

Built-ins SHALL use the normal immutable extension-slot format, public manifest validation, extension host, IPC protocol, permissions, crash isolation, and compatibility checks.

#### Scenario: Loading a built-in

- **WHEN** a built-in extension is loaded
- **THEN** it passes the same manifest validation, permission model, IPC protocol, crash isolation, and compatibility checks as any other extension

### Requirement: First-run materialization

On first start, the server SHALL materialize the release's verified artifacts into server-owned slots and SHALL record their origin as `built-in`. Materialization SHALL be idempotent and crash-safe. A clean Electron or standalone-server installation SHALL expose both built-ins, `terminay-builtin-agents` and `terminay-language-typescript`, without npm or network access.

#### Scenario: Clean installation

- **WHEN** a clean Electron or standalone server starts for the first time
- **THEN** the built-in agents and TypeScript language extensions are materialized from verified release artifacts without npm or network access

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

An incompatible or failed built-in SHALL be represented like any other failed extension and SHALL NOT prevent the server or unrelated extensions from becoming ready. Dependent extensions SHALL show the ordinary dependency failure. Built-in extensions SHALL appear once in Settings with a **Built in** and **Official** origin, and SHALL NOT appear as duplicate catalogue and installed entries.

#### Scenario: Incompatible built-in

- **WHEN** a built-in is incompatible or fails to activate
- **THEN** the server and unrelated extensions still become ready and dependent extensions show the ordinary dependency failure

#### Scenario: Settings listing

- **WHEN** a user views Settings
- **THEN** each built-in appears exactly once, marked **Built in** and **Official**

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

### Requirement: TypeScript language extension serves the project's TypeScript

`terminay-language-typescript` SHALL contribute a language server that serves
`.ts`, `.tsx`, `.js`, and `.jsx` files. It SHALL launch
`typescript-language-server` against the TypeScript installed in the project when
the project has one, and against the TypeScript bundled with the extension
otherwise, and SHALL report which of the two it used. Its behaviour SHALL be
proven against the real `typescript-language-server` in the package's
conformance tests rather than against a stub.

#### Scenario: Project with its own TypeScript

- **WHEN** a language session starts for a project that has TypeScript installed
- **THEN** `typescript-language-server` runs against the project's TypeScript and
  the session reports that it used the project's TypeScript

#### Scenario: Project without TypeScript

- **WHEN** a language session starts for a project with no TypeScript installed
- **THEN** the extension's bundled TypeScript is used and the session reports that
  it used the bundled TypeScript

#### Scenario: Conformance against the real language server

- **WHEN** the package's conformance tests run
- **THEN** they exercise the real `typescript-language-server` and assert
  diagnostics, completion, hover, and definition for `.ts`, `.tsx`, `.js`, and
  `.jsx` files
