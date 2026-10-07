## ADDED Requirements

### Requirement: Agent session source contribution and registration

A package SHALL declare each session source under `contributes.agentSessionSources`. Each declaration SHALL carry:

- a namespaced source id
- a display name
- supported platforms
- a bounded list of harnesses, each with a stable harness id and a display name
- a bounded list of server environment variable names the source needs, such as a harness's home-directory override, which the host SHALL pass to the extension child when set

At activation the extension SHALL register each declared source through `context.agents.registerSessionSource(id, runtime)`, which SHALL return a disposable registration. Registration SHALL be refused for an undeclared id, a duplicate id, or a registration after deactivation. The runtime SHALL receive the set of harnesses currently switched on and a publisher. Through the publisher it SHALL send:

- the full set of live sessions (a reset)
- upserts of individual session snapshots
- removals by session id

A session snapshot SHALL carry:

- a source-scoped session id
- a declared harness id
- the owning process id
- the working directory
- optionally: title, model, status (`running`, `waiting`, `blocked`, or `idle`), waiting description, current tool name, last-turn outcome and end time, a bounded error message, and a bounded list of subagents, each with a stable id, optional parent id, type, title, and status

Every string SHALL be bounded, and a snapshot naming an undeclared harness or a harness that is switched off SHALL be rejected. The host SHALL deliver changes to the enabled harness set to the running source, and the source SHALL stop reporting a harness switched off and SHALL report the live sessions of a harness switched on.

#### Scenario: Registering a declared source

- **WHEN** an extension registers a session source id its manifest declared
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Undeclared harness in a snapshot

- **WHEN** a source publishes a snapshot naming a harness it did not declare
- **THEN** the snapshot is rejected and the store is unchanged

#### Scenario: Harness switched on at runtime

- **WHEN** the user switches a harness on while its source is running
- **THEN** the source receives the new enabled set and publishes that harness's live sessions

### Requirement: Harness switches for session sources

Settings SHALL show, under each extension that contributes a session source, one switch per declared harness. Every switch SHALL be on by default. Switch state SHALL be server-scoped host settings keyed by source id and harness id, and SHALL persist across restarts, upgrades, and extension updates. The host SHALL apply a switch change to the running source without restarting its extension.

#### Scenario: Harness switches shown

- **WHEN** the user views an extension that contributes a session source declaring four harnesses
- **THEN** its card shows four harness switches, each on unless the user switched it off

#### Scenario: Switch survives an update

- **WHEN** the user switches off a harness and the extension is later updated
- **THEN** the harness remains off

### Requirement: MCP install target contribution

A package SHALL declare each MCP install target under `contributes.mcpInstallTargets`. Each declaration SHALL carry a namespaced target id and a client display name. At activation the extension SHALL register each declared target through `context.mcp.registerInstallTarget(id, runtime)`, which SHALL return a disposable registration. The runtime SHALL implement `status`, `install`, and `uninstall`. Each SHALL receive the host-supplied Terminay MCP server command — executable, arguments, and environment — and a cancellation signal. `status` SHALL return:

- one of not installed, installed, changed, unavailable, or error
- the provider-owned configuration path it inspects
- a bounded, redacted detail message

The host SHALL supply the MCP server command only when the server can run the MCP adapter. Otherwise it SHALL report every target unavailable without calling the extension. Registration SHALL be refused for undeclared or duplicate ids.

#### Scenario: Target status requested

- **WHEN** the host asks a registered target for its status
- **THEN** the extension returns a bounded state, configuration path, and redacted detail

#### Scenario: Server without an MCP adapter

- **WHEN** the server cannot run the Terminay MCP adapter
- **THEN** every install target is reported unavailable and no extension call is made

## MODIFIED Requirements

### Requirement: Bounded API scope

The public API SHALL support session sources, MCP install targets, and language servers. Themes, editor plugins, autocomplete sources, arbitrary commands, renderer components, and generic Server Core operation registration SHALL be out of scope.

#### Scenario: Unsupported contribution kind

- **WHEN** a package declares a theme, editor plugin, autocomplete source,
  arbitrary command, renderer component, or generic Server Core operation
- **THEN** the contribution is not supported and validation rejects it

#### Scenario: Language server contribution

- **WHEN** a package declares a language server contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Session source contribution

- **WHEN** a package declares a session source or MCP install target contribution
- **THEN** it is a supported contribution kind and validation accepts it

### Requirement: Official catalogue and release-bundled artifacts

Terminay SHALL ship an official catalogue containing the built-in agents and TypeScript language npm packages and their expected metadata. Verified package artifacts for that exact release SHALL be embedded in Electron and standalone server distributions, installed without network access, and enabled by default. Official packages SHALL use the same public manifest, extension host, and compatibility checks as custom packages. The **Official** badge SHALL be catalogue metadata, not a privileged runtime tier.

#### Scenario: Offline first start

- **WHEN** a server starts with no network access
- **THEN** its release-bundled official extensions are installed from embedded
  verified artifacts and enabled by default

#### Scenario: Built-in has no private access

- **WHEN** a built-in package activates
- **THEN** it passes the same public manifest, host, and compatibility contract as a custom package and receives no private API access

### Requirement: Archive inspection fails closed

The following SHALL fail closed before extension code is imported:

- archive traversal, absolute paths, links, or non-regular entries
- duplicate package manifests
- excess entry or unpacked-size bounds
- malformed gzip or tar data
- a required install lifecycle script
- a materialized manifest that differs from preview

Prebuilt native modules SHALL be accepted.

#### Scenario: Traversal entry in an archive

- **WHEN** an uploaded archive contains a traversal path, absolute path, link,
  non-regular entry, duplicate manifest, or malformed data
- **THEN** the install fails before any extension code is imported

#### Scenario: Materialized manifest differs from preview

- **WHEN** the materialized manifest does not match the confirmed preview
- **THEN** the install fails closed

#### Scenario: Prebuilt native module

- **WHEN** an archive contains a prebuilt `.node` module and requires no install script
- **THEN** inspection accepts it

### Requirement: Contribution arrays

`contributes.agentSessionSources`, `contributes.mcpInstallTargets`, and `contributes.languageServers` SHALL be the supported contribution arrays, and at least one supported contribution SHALL be required.

#### Scenario: Agent-only package

- **WHEN** a package contributes one or more session sources
- **THEN** it passes contribution validation

#### Scenario: No contributions

- **WHEN** a package declares no contribution array
- **THEN** validation fails

#### Scenario: Language-server-only package

- **WHEN** a package contributes one or more language servers and nothing else
- **THEN** it passes contribution validation

### Requirement: One package, one immutable extension identity

One npm package SHALL contribute one immutable extension identity. Its `package.json` SHALL contain a closed, runtime-validated `terminay` object with:

- a `manifestVersion`
- a globally collision-resistant immutable extension id
- a display name and bounded description
- a Terminay Extension API range, and Terminay and Node engine compatibility
- one relative ESM entrypoint exported inside the package
- declared permissions
- Terminay extension dependencies and compatible contribution ranges
- namespaced contributions

#### Scenario: Closed manifest object

- **WHEN** the `terminay` object contains an unknown field
- **THEN** validation fails before import

#### Scenario: Valid manifest

- **WHEN** a package declares every required manifest field within its bounds
- **THEN** the package passes manifest validation

### Requirement: Agent observation permission

A session source SHALL require the `agent-observation` permission, and an MCP install target SHALL require the `mcp-registration` permission. `agent-observation` SHALL authorize session-snapshot publication and receipt of the enabled harness set. `mcp-registration` SHALL authorize receipt of the Terminay MCP server command. Neither SHALL grant client authority or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** a package declares a session source without `agent-observation`, or an MCP install target without `mcp-registration`
- **THEN** manifest validation fails

#### Scenario: Permission scope

- **WHEN** `agent-observation` is granted
- **THEN** it authorizes session-snapshot publication only

### Requirement: Transactional installation pipeline

Installation SHALL:

- resolve the exact package, version, and integrity, and fetch metadata for preview
- require an authorized confirmation bound to that preview digest
- create an isolated staging slot and exact lockfile
- reject non-npmjs, git, file, link, or remote dependencies, and missing integrity
- materialize production and optional dependencies with lifecycle scripts disabled, development dependencies omitted, and binary links disabled
- reject trees containing `binding.gyp` or required install lifecycle scripts, while accepting prebuilt native `.node` modules
- validate file, count, size, symlink, entrypoint, manifest, API, and engine limits, and record package-lock and inventory hashes
- atomically promote an immutable content-addressed version slot
- probe it in a fresh extension host
- change the active pointer only after successful definition and registration

#### Scenario: Exact package installs cleanly

- **WHEN** a custom exact npm package is installed
- **THEN** it materializes with lifecycle scripts disabled and cannot use a git, file, http, or alias specification or a tree requiring a native build or install script

#### Scenario: Prebuilt native dependency

- **WHEN** a package's production or optional dependency ships a prebuilt `.node` module
- **THEN** it materializes and the extension may load it

#### Scenario: Active pointer moves last

- **WHEN** the probe in a fresh extension host succeeds and definition and
  registration complete
- **THEN** the active pointer changes to the new content-addressed slot

### Requirement: A failed host is restarted under supervision

A host whose child exits unexpectedly SHALL be restarted automatically when its computed restart backoff expires, without requiring a server or application restart. Backoff SHALL grow with consecutive failures up to the maximum, and restart attempts SHALL stop once the extension is quarantined. A restart SHALL re-publish the extension's contributions. Its session sources SHALL report their full live set again.

#### Scenario: Host crashes once during a session

- **WHEN** an extension host child exits unexpectedly while the server is
  running
- **THEN** the host is restarted after its backoff expires and its
  contributions become available again

#### Scenario: Repeated crashes

- **WHEN** failures continue past the crash threshold within the crash window
- **THEN** the extension is quarantined and no further automatic restart is
  attempted

#### Scenario: Agent provider returns after a crash

- **WHEN** a session source's host is restarted while an agent runs in a terminal
- **THEN** the source reports that session again and it binds to its terminal without a new terminal or CLI process

### Requirement: Extensions section content

The Extensions section SHALL name the selected Terminay Server as the authority. It SHALL show:

- the built-in agents and TypeScript language cards
- installed and disabled states
- available explicit updates
- compatibility and failure details
- permissions
- dependants
- **Install from npm…**

A session source extension's card SHALL show its harness switches. A language server extension's card SHALL show the languages it serves and an enable toggle for that extension.

#### Scenario: Viewing extension state

- **WHEN** the user opens Extensions
- **THEN** the selected server is named as the authority and built-in cards,
  installed and disabled state, available explicit updates, compatibility and
  failure detail, permissions, dependants, and **Install from npm…** are shown

#### Scenario: Viewing the built-in agents extension

- **WHEN** the user views the built-in agents extension's card
- **THEN** it shows switches for Claude Code, Codex, Grok, and oh-my-pi

#### Scenario: Viewing a language server extension

- **WHEN** the user views a language server extension's card
- **THEN** it shows the languages that extension serves and a per-extension enable
  toggle

### Requirement: Public agent-extension harness and third-party author example

The public SDK SHALL ship an in-memory session-source test harness and a documented author example. The repository SHALL contain a minimal third-party session-source extension package that is not derived from an official one. That package SHALL build, pack, activate, and pass conformance using only the public SDK. Generated API reference material SHALL document every snapshot bound, the reset, upsert, and removal ordering guarantees, the harness-switch rules, and the error classes needed to build, test, package, and diagnose a session source without reading Terminay source.

#### Scenario: Third-party fixture extension

- **WHEN** the independent third-party session-source fixture is packed and activated
- **THEN** it registers a source and publishes session snapshots using only the public SDK

#### Scenario: Author documentation completeness

- **WHEN** an author consults the generated API reference
- **THEN** it documents snapshot bounds, ordering guarantees, harness-switch rules, and error classes for a session source

### Requirement: Registration is bound to declared contributions

Registering a session source, MCP install target, or language server SHALL be accepted only for an id the registering package's own manifest declares. A registration made under an id the package does not declare, or under another package's namespace, SHALL be refused.

#### Scenario: Undeclared provider id

- **WHEN** an extension registers a contribution under an id its manifest does not
  declare
- **THEN** the registration is refused

#### Scenario: Declared provider id

- **WHEN** an extension registers a contribution under an id its manifest declares
- **THEN** the registration is accepted and returns a disposable registration

### Requirement: Cancellation and disposal on every long-running API

Every long-running API SHALL accept a cancellation signal. A session source runtime SHALL receive a signal that fires when the source is disposed, the extension is disabled, or agent status is switched off. Each MCP install target call SHALL receive a signal that fires on its deadline or on disposal. Watchers SHALL be asynchronously disposable and idempotent to close.

#### Scenario: Foreground process leaves

- **WHEN** agent status is switched off or the extension is disabled
- **THEN** the session source's cancellation signal fires and it stops watching

#### Scenario: Closing a watcher twice

- **WHEN** a watcher is closed more than once
- **THEN** the close is idempotent and raises no error

### Requirement: Public conformance test harness

`@terminay/extension-api` SHALL publish a testing entry point providing an extension harness. A package SHALL be able to drive its session sources and MCP install targets and assert what they publish without importing Server Core or any other private Terminay module. The harness SHALL check:

- agreement between manifest and registration
- snapshot bounds
- declared harnesses and the enabled-set rule
- reset, upsert, and removal validity
- cancellation
- privacy exclusions

#### Scenario: Testing a mapping

- **WHEN** a package runs its session source through the public harness
- **THEN** it asserts the snapshots published without importing Server Core

#### Scenario: Harness conformance checks

- **WHEN** a package is exercised through the harness
- **THEN** manifest and registration agreement, bounds, harness rules, publication validity, cancellation, and privacy exclusions are checked

### Requirement: Host-owned behaviours excluded from extension authorship

Terminay SHALL own all of these, and the API SHALL offer an extension no means of implementing them:

- sidebar components and styling
- project scoping and worktree resolution
- terminal binding
- project and terminal navigation
- client subscriptions and remote transport
- acknowledgement and unread behaviour
- canonical ordering
- extension enable and disable surfaces, and harness switch surfaces
- the MCP install surface
- extension process lifetime and crash backoff
- Electron-versus-standalone packaging

An extension SHALL supply only session facts and MCP registration knowledge.

#### Scenario: Extension attempts a host behaviour

- **WHEN** an extension attempts to render sidebar UI, navigate the workspace,
  bind a session to a terminal, or order canonical events
- **THEN** no such API is available to it

#### Scenario: Provider responsibilities

- **WHEN** a session source package is authored
- **THEN** it implements session detection, harness reporting, bounded snapshots, and privacy exclusions, and nothing else

### Requirement: Public extension API capabilities for agent extensions

The API SHALL permit an extension to:

- define redacted profile types
- contribute declarative status, progress, confirmation, and lifecycle surfaces
- receive its own namespaced configuration, data, and cache directories
- request resolution of its own profile-bound secret fields through a scoped broker
- implement runtime callbacks through bounded typed IPC with cancellation, deadlines, and concurrency limits
- contribute a session source and publish bounded machine-wide session snapshots
- contribute MCP install targets that receive the host-supplied MCP server command

#### Scenario: Runtime callback bounds

- **WHEN** an MCP install target callback runs
- **THEN** it is subject to cancellation, deadlines, and concurrency limits over bounded typed IPC

#### Scenario: Publishing agent lifecycle events

- **WHEN** a session source publishes snapshots
- **THEN** they are validated before they reach the host-owned canonical projection

### Requirement: Node APIs and the terminal-evidence boundary

An extension MAY use public Node.js APIs and its declared npm dependencies, native ones included, for ordinary work on the Terminay Server account. Nothing an extension reports SHALL be treated as terminal identity. Terminal binding SHALL be decided by the host from process ancestry. An extension MUST NOT import a private Terminay module to obtain internal services.

#### Scenario: Reading extension preferences

- **WHEN** an extension reads its own configuration file from the Terminay
  Server account with Node APIs
- **THEN** the read is permitted

#### Scenario: Establishing terminal evidence

- **WHEN** a session source reports a session
- **THEN** the host, not the extension, decides which terminal, if any, it binds to

## REMOVED Requirements

### Requirement: Agent provider registration and terminal-incarnation admission

**Reason**: Terminal-scoped agent providers are removed in Extension API 3.0.
**Migration**: Register an `agentSessionSources` contribution with `context.agents.registerSessionSource`.

### Requirement: Exact-once observer retirement

**Reason**: No terminal observation contexts exist.
**Migration**: None; sources are disposed through ordinary registration disposal.

### Requirement: Terminal-scoped directory list and watch operations

**Reason**: The observation broker is removed.
**Migration**: Use Node filesystem APIs inside the extension.

### Requirement: Public observation adapters and driver toolkit

**Reason**: The driver toolkit is removed.
**Migration**: Use a detection library such as `@markwylde/all-your-agents` inside the extension.

### Requirement: Host-issued terminal context for observation

**Reason**: No terminal context is issued to extensions.
**Migration**: None; the host binds sessions by process ancestry.

### Requirement: Terminal-scoped handles are opaque and scoped to one terminal

**Reason**: The observation broker and its handles are removed.
**Migration**: None.

### Requirement: Not-bound observation names the directories it awaits

**Reason**: No observation attempts or `not-bound` outcomes exist.
**Migration**: A session source watches its own files continuously.
