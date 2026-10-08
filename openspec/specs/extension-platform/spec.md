# extension-platform Specification

## Purpose

Define how npm-distributed, server-installed extension packages add
coding-agent and language-server providers to a selected Terminay Server,
covering their manifest contract, public API, declarative UI contributions,
isolated host lifecycle, transactional installation, secrets, and permissions.

## Requirements

### Requirement: Extensions execute only on the selected server

Terminay extensions SHALL be npm-distributed, server-installed packages that add
coding-agent providers. They SHALL execute only on the selected Terminay Server.
Desktop and browser clients SHALL render bounded declarative contributions from
the server's matching UI bundle and MUST NOT load extension code.

#### Scenario: Client renders an extension contribution

- **WHEN** a client displays an extension's profile or status surface
- **THEN** it renders bounded declarative data from the server's matching UI
  bundle and loads no extension code

#### Scenario: Embedded and standalone parity

- **WHEN** the same extension package is installed on an embedded and on a
  standalone server
- **THEN** both install and run it identically, and Desktop and browser clients
  neither store nor execute it

### Requirement: Bounded API scope

The public API SHALL support session sources, MCP install targets, language servers, and worktree insights. Themes, editor plugins, autocomplete sources, arbitrary commands, renderer components, and generic Server Core operation registration SHALL be out of scope.

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

#### Scenario: Worktree insight contribution

- **WHEN** a package declares a worktree insight contribution
- **THEN** it is a supported contribution kind and validation accepts it

### Requirement: Server-wide installation scope

Extensions SHALL be installed server-wide under the selected Terminay Server
data root. Embedded and standalone servers SHALL expose the same manager and
runtime. Opening Extensions on a remote server SHALL manage that server, not
Desktop's embedded server.

#### Scenario: Managing a remote server's extensions

- **WHEN** the user opens Extensions while connected to a remote server
- **THEN** the manager acts on that remote server's installation, not on
  Desktop's embedded server

### Requirement: Official catalogue and release-bundled artifacts

Terminay SHALL ship an official catalogue containing the built-in agents and TypeScript language npm packages and their expected metadata. Verified package artifacts for that exact release SHALL be embedded in Electron and standalone server distributions, installed without network access, and enabled by default. Official packages SHALL use the same public manifest, extension host, and compatibility checks as custom packages. The **Official** badge SHALL be catalogue metadata, not a privileged runtime tier.

#### Scenario: Offline first start

- **WHEN** a server starts with no network access
- **THEN** its release-bundled official extensions are installed from embedded
  verified artifacts and enabled by default

#### Scenario: Built-in has no private access

- **WHEN** a built-in package activates
- **THEN** it passes the same public manifest, host, and compatibility contract as a custom package and receives no private API access

### Requirement: Install from npm

**Install from npm…** SHALL accept a public npmjs package name and optional
version, range, or tag, SHALL resolve it once, SHALL display the exact result,
and SHALL require an authorized confirmation bound to that preview. Active
records SHALL store only the exact version and registry integrity. Terminay MUST
NOT silently follow `latest` or auto-update.

#### Scenario: Installing a tag

- **WHEN** the user installs a package by tag
- **THEN** the tag is resolved once, the exact resolved version is displayed and
  confirmed, and only that exact version and its registry integrity are recorded

#### Scenario: No auto-update

- **WHEN** a newer version is published upstream
- **THEN** the installed version is unchanged until an explicit update is
  confirmed

### Requirement: Install from an uploaded package file

**Install package file…** SHALL accept one bounded gzip tarball produced by
`npm pack`. The client SHALL upload its bytes to the selected Terminay Server and
MUST NOT send a local path for the server to open. The server SHALL hash and
inspect the archive before preview, SHALL bind confirmation to the exact uploaded
digest, and SHALL feed it through the same scripts-disabled validation,
immutable-slot, probe, activation, update, and rollback path as a registry
package. The compressed upload limit SHALL be 12 MiB. Preview state and uploaded
bytes SHALL expire together after ten minutes and SHALL be removed after
confirmation, failure, or server restart. Desktop and browser clients SHALL
retain no archive after the upload command completes.

#### Scenario: Local path instead of bytes

- **WHEN** a client sends a local filesystem path for a package file install
- **THEN** the request is rejected; only uploaded bytes are accepted

#### Scenario: Preview expiry

- **WHEN** an upload preview is not confirmed within ten minutes, or the server
  restarts
- **THEN** the preview state and the uploaded bytes are removed together

#### Scenario: Digest-bound confirmation

- **WHEN** the confirmation does not match the exact uploaded archive digest
- **THEN** installation is refused

### Requirement: Dependency resolution for uploaded packages

An uploaded root package MAY resolve from its server-owned staging archive. All
transitive packages SHALL still resolve from public npmjs with integrity.
Aliases, Git, HTTP tarballs, arbitrary file or directory dependencies, arbitrary
registries, and shell-like specifications SHALL be rejected.

#### Scenario: Transitive git dependency

- **WHEN** an uploaded package depends transitively on a git, alias, HTTP
  tarball, file, directory, or alternate-registry specification
- **THEN** installation fails closed

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

### Requirement: Uploaded package labelling

Uploaded packages SHALL be labelled **Uploaded package · Unverified**. A
catalogue name or extension id alone MUST NOT grant the Official badge; that
badge on an uploaded archive requires a release-pinned digest match. The preview
SHALL show filename, exact name and version, archive integrity, permissions,
dependency facts, and the trusted-code warning.

#### Scenario: Uploaded archive claims an official id

- **WHEN** an uploaded archive declares a catalogue name or official extension id
- **THEN** it is still labelled **Uploaded package · Unverified** without a
  release-pinned digest match

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

### Requirement: Contribution arrays

`contributes.agentSessionSources`, `contributes.mcpInstallTargets`, `contributes.languageServers`, and `contributes.worktreeInsights` SHALL be the supported contribution arrays, and at least one supported contribution SHALL be required.

#### Scenario: Agent-only package

- **WHEN** a package contributes one or more session sources
- **THEN** it passes contribution validation

#### Scenario: No contributions

- **WHEN** a package declares no contribution array
- **THEN** validation fails

#### Scenario: Language-server-only package

- **WHEN** a package contributes one or more language servers and nothing else
- **THEN** it passes contribution validation

#### Scenario: Worktree-insight-only package

- **WHEN** a package contributes one or more worktree insight sources and nothing
  else
- **THEN** it passes contribution validation

### Requirement: Identity separation and namespacing

Package name and extension id SHALL be separate so repository or package
ownership can change without breaking persisted extension identities. Provider,
action, and form ids SHALL be namespaced by the immutable extension id. Unknown
manifest fields, duplicate identities, core-operation collisions, absolute or
escaping entry paths, symlinks, non-regular entrypoints, incompatible versions,
unsupported platform metadata, and unbounded collections SHALL fail validation
before import.

#### Scenario: Provider id collision

- **WHEN** two packages would register the same provider id, or a package
  collides with a core operation
- **THEN** validation fails closed before import

#### Scenario: Escaping entrypoint

- **WHEN** the declared entrypoint is absolute, escapes the package, is a
  symlink, or is not a regular file
- **THEN** validation fails before import

### Requirement: Independent version axes and exact API compatibility

The independent version axes SHALL be npm package SemVer, manifest-format
integer, and Terminay Extension API SemVer. API major versions SHALL be breaking
and minors additive. The server SHALL activate an extension only when its exact
supported API satisfies the declared range, and MUST NOT guess or coerce
compatibility.

#### Scenario: Declared range not satisfied

- **WHEN** the server's exact supported Extension API does not satisfy the
  package's declared range
- **THEN** the extension is not activated and is represented as incompatible

### Requirement: Author SDK and import boundary

`@terminay/extension-api` SHALL be a dependency-light author SDK containing
types, runtime schemas, fixtures, and conformance tooling. Extensions SHALL use
it as a development or type dependency, and the host SHALL inject privileged
broker objects. An extension MUST NOT import `@terminay/server-core`, the
workspace repository, authentication contexts, client transports, Electron, or
host bridges.

#### Scenario: Private import attempted

- **WHEN** an extension imports a private Terminay package or an internal host
  bridge
- **THEN** that import is prohibited by the public Extension API contract

### Requirement: Public extension API exclusions

The API MUST NOT expose raw application-protocol handlers, operation policies,
workspace snapshots, arbitrary vault ids, other extension instances,
authenticated client envelopes, UI-bundle internals, terminal data outside the
broker-issued terminal scope, canonical store mutation, renderer hooks, or native
host APIs.

#### Scenario: Terminal data outside scope

- **WHEN** an extension requests terminal data outside its broker-issued terminal
  scope
- **THEN** the request is refused

#### Scenario: Direct canonical mutation

- **WHEN** an extension attempts to mutate the canonical store directly
- **THEN** no such API exists and the attempt fails

### Requirement: Agent observation permission

A session source SHALL require the `agent-observation` permission, and an MCP install target SHALL require the `mcp-registration` permission. `agent-observation` SHALL authorize session-snapshot publication and receipt of the enabled harness set. `mcp-registration` SHALL authorize receipt of the Terminay MCP server command. Neither SHALL grant client authority or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** a package declares a session source without `agent-observation`, or an MCP install target without `mcp-registration`
- **THEN** manifest validation fails

#### Scenario: Permission scope

- **WHEN** `agent-observation` is granted
- **THEN** it authorizes session-snapshot publication only

### Requirement: Extensions are trusted Node programs

Extensions SHALL be ordinary trusted Node.js programs and MAY use public Node
APIs and declared npm dependencies with the selected server account's authority.
"Public Extension API only" SHALL prohibit imports from private Terminay packages
and internal host bridges, not Node.js. Per-extension processes SHALL isolate
crashes and reduce accidental cross-extension secret sharing, but MUST NOT be
presented as an operating-system security sandbox.

#### Scenario: Extension uses Node APIs

- **WHEN** an extension uses public Node filesystem or network APIs
- **THEN** it operates with the selected server account's authority

#### Scenario: Warning describes real authority

- **WHEN** the installation warning is shown
- **THEN** it describes the extension's broader filesystem and network authority
  rather than promising sandbox protection

### Requirement: Declarative UI contribution surface

Extension code MUST NOT enter the renderer. Fixed `extensions.*`
application-protocol operations SHALL return bounded schemas and safe status
data. The server-bundled generic UI SHALL support sections and accessible
disclosures; text, number, URL, secret, checkbox, switch, and textarea fields;
searchable asynchronous selectors with deadlines and cancellation; radio-like
preset cards; conditional visibility and disabled reasons; inline validation plus
an error summary; progress stages and resumable operation status; ordinary and
destructive confirmations; and guarded credential-free HTTPS links.

#### Scenario: Asynchronous selector

- **WHEN** an extension contributes a searchable asynchronous selector
- **THEN** the generic UI enforces its deadline and supports cancellation

#### Scenario: Renderer DTO contents

- **WHEN** a renderer DTO is produced for an extension surface
- **THEN** it contains no extension code, raw HTML, credentials, filesystem paths
  outside authorized presentation, or arbitrary host actions

### Requirement: Content and styling limits for contributions

Icons SHALL come from a Terminay-owned allowlist. Strings SHALL render as text;
raw HTML, CSS, SVG, scripts, React components, iframes, generic routes, and
arbitrary external navigation SHALL NOT be supported. The schema SHALL control
content and progressive disclosure, not visual styling. Terminay alone SHALL map
every contribution onto its shared Settings primitives: category headers, section
labels, groups, rows, controls, compact disclosures, validation, and action
footers. Extensions MUST NOT request grids, arbitrary card containers, spacing,
colours, or sizing.

#### Scenario: Markup in a contributed string

- **WHEN** a contributed string contains HTML or script markup
- **THEN** it renders as text

#### Scenario: Native appearance across hosts

- **WHEN** the same contribution schema renders for a built-in or a third-party
  provider on Desktop or in a browser
- **THEN** it looks native to Terminay through the shared Settings primitives

### Requirement: Activation is required for successful installation

An enabled extension MUST NOT be treated as successfully installed merely because
its package passes a probe. After the immutable slot is committed, the Terminay
Server SHALL activate that exact slot and SHALL keep its provider process
running. On server startup every enabled, compatible active slot SHALL be
restored before provider catalogues are served. Activation failure SHALL be
represented explicitly.

#### Scenario: Startup restore order

- **WHEN** the server starts
- **THEN** every enabled compatible active slot is restored before provider
  catalogues are served

#### Scenario: Activation fails

- **WHEN** activation of an extension fails
- **THEN** the failure is represented explicitly rather than presented as a
  running extension

### Requirement: Built-in reconciliation includes activation

When the selected server reconciles release-built-ins after startup,
materializing a new enabled active slot SHALL include bounded host activation
before reconciliation completes. The host manager SHALL publish the new provider
ownership and contribution set only after activation succeeds. While activation is
in progress, management SHALL surface a pending activation state; if it fails,
management SHALL surface the bounded failure and offer Restart. Management MUST
NOT present the extension as installed while no running host owns its declared
providers.

#### Scenario: Reconciliation in progress

- **WHEN** a release-built-in slot is being activated during reconciliation
- **THEN** management shows a pending activation state and publishes provider
  ownership only after activation succeeds

#### Scenario: Reconciliation activation fails

- **WHEN** activation fails during reconciliation
- **THEN** management shows the bounded failure with a Restart action and does not
  present the extension as installed

### Requirement: Isolated extension child process

Terminay Server SHALL run each enabled extension in its own child process under
the server's bundled Node runtime. The process SHALL use a private inherited
framed channel, a minimal environment, an immutable package-slot working
directory, bounded messages, timeouts, cancellation, admission and concurrency
limits, and rate-limited restart and backoff. Credentials MUST be absent from
argv, ordinary environment variables, logs, and inherited stdio.

#### Scenario: Repeated crash

- **WHEN** an extension child crashes repeatedly
- **THEN** restarts are rate-limited with backoff

#### Scenario: Credential hygiene

- **WHEN** an extension child is launched
- **THEN** no credential appears in argv, ordinary environment variables, logs, or
  inherited stdio

### Requirement: Electron-hosted extension child launch

When Desktop supplies Electron's executable as the bundled runtime, the child
SHALL be launched with `ELECTRON_RUN_AS_NODE=1`. Extension activation MUST NOT
enter Electron application startup or create a Desktop window. Desktop SHALL
package the renderer-free extension child as an explicit immutable
`dist-electron/extensionHostEntry.js` executable entrypoint and SHALL pass that
regular file to the embedded server; bundled `import.meta.url` inference MUST NOT
be an execution authority.

#### Scenario: Activating under Desktop

- **WHEN** an extension activates on a Desktop-embedded server
- **THEN** the child runs with `ELECTRON_RUN_AS_NODE=1` and no Desktop window is
  created

#### Scenario: Entrypoint authority

- **WHEN** the embedded server launches the extension child
- **THEN** it uses the explicit packaged `dist-electron/extensionHostEntry.js`
  regular file rather than inferring one from `import.meta.url`

### Requirement: Entrypoint resolution at import time

The installer SHALL pass the manifest's validated relative entrypoint unchanged
to the host, and the host SHALL resolve and canonicalize it within the immutable
package slot immediately before import.

#### Scenario: Entrypoint canonicalization

- **WHEN** the host imports an extension entrypoint
- **THEN** it resolves and canonicalizes the validated relative path within the
  immutable package slot immediately before import

### Requirement: Materialization and activation failure leaves the prior state

If materialization or activation fails, the selected server SHALL return a
bounded, actionable failure message to the management UI while leaving the
previous installed version and active pointer unchanged.

#### Scenario: Failed update

- **WHEN** materialization or activation of a new version fails
- **THEN** the previous installed version and active pointer remain unchanged and
  the management UI receives a bounded actionable failure message

### Requirement: Startup validation and lazy activation

Server startup SHALL validate registry records, built-in inventories, and
manifests without executing disabled or incompatible packages. Providers SHALL
activate lazily on management, profile, or project use. States SHALL distinguish
bundled and installed, enabled and disabled, compatible and incompatible,
stopped, starting, running, and failed, quarantined, and pending update.

#### Scenario: Disabled package at startup

- **WHEN** a disabled or incompatible package is present at startup
- **THEN** its records and manifest are validated but its code is not executed

#### Scenario: Lazy activation

- **WHEN** a provider is first used through management, a profile, or a project
- **THEN** it activates at that point

### Requirement: Crash containment

One crash SHALL mark only that extension unavailable. It MUST NOT prevent server
readiness or crash another provider. An extension's failure SHALL NOT end the
process that hosts it: every error its host observes from the child process,
from writing to its channel, or from terminating it SHALL be handled by the
host, however many are raised and whenever they arrive. Every crash SHALL be
recorded in the local diagnostic history with the extension id, the observed
exit code or signal, and the error the child reported.

#### Scenario: Provider crash

- **WHEN** an extension host process crashes
- **THEN** only that extension is marked unavailable, and the server and other
  providers remain usable

#### Scenario: Child dies while its host is still writing to it

- **WHEN** an extension child dies while its host has acknowledgements or
  replies still being written, and the operating system refuses those writes
- **THEN** the process hosting the extension keeps running, and the refusals
  are recorded rather than raised

#### Scenario: Crash leaves evidence

- **WHEN** an extension host process crashes
- **THEN** the local diagnostic history records the extension id, the exit code
  or signal, and the reported error

### Requirement: A child reports its fatal error before exiting

An extension child SHALL report a bounded fatal-error frame to its host before
exiting on an uncaught exception or an unhandled rejection. The frame SHALL
carry the error name, message, stack, and the exit code the child is about to
use. A child SHALL NOT terminate silently on a fatal error, and a host that
never receives the frame SHALL still record the exit code or signal it
observed.

#### Scenario: Uncaught exception in extension code

- **WHEN** extension code throws an uncaught exception
- **THEN** the child sends its host the error name, message, stack, and exit
  code before the process ends

#### Scenario: Child dies before it can report

- **WHEN** a child is killed without a chance to report
- **THEN** the host still records the observed exit code or terminating signal

### Requirement: A failed host is restarted under supervision

A host whose child exits unexpectedly SHALL be restarted automatically when its
computed restart backoff expires, without requiring a server or application
restart. Backoff SHALL grow with consecutive failures up to the maximum, and
restart attempts SHALL stop once the extension is quarantined. A restart SHALL
re-publish the extension's contributions. Its session sources SHALL report
their full live set again. A child that exits after the host reports running but
before its contributions are published SHALL be supervised on the same terms:
the host keeps its failed state and its scheduled restart, and the manager
SHALL NOT convert that failure into a deliberate stop.

#### Scenario: Host crashes once during a session

- **WHEN** an extension host child exits unexpectedly while the server is
  running
- **THEN** the host is restarted after its backoff expires and its
  contributions become available again

#### Scenario: Host crashes before its contributions are published

- **WHEN** an extension host child exits after the host reports running and
  before the manager publishes its contributions
- **THEN** the activation fails, the host stays failed with its restart
  scheduled, and the restart brings the host back and publishes its
  contributions

#### Scenario: Repeated crashes

- **WHEN** failures continue past the crash threshold within the crash window
- **THEN** the extension is quarantined and no further automatic restart is
  attempted

#### Scenario: Agent provider returns after a crash

- **WHEN** a session source's host is restarted while an agent runs in a terminal
- **THEN** the source reports that session again and it binds to its terminal without a new terminal or CLI process

### Requirement: Quarantine is recoverable without an application restart

An explicit restart of a quarantined extension SHALL clear its quarantine,
reset its crash window, and start the host. The restart control SHALL remain
available while an extension is quarantined, and a quarantined extension SHALL
report that state so a person can see why it is not running.

#### Scenario: Restarting a quarantined extension

- **WHEN** a person restarts an extension shown as quarantined
- **THEN** its quarantine and crash window are cleared and the host starts

#### Scenario: Quarantined extension is visible

- **WHEN** an extension is quarantined
- **THEN** its state is reported as quarantined rather than as installed and
  running

### Requirement: A closed channel is not a protocol violation

Failing to write to an extension child whose channel is missing or already
closed SHALL be treated as the ordinary consequence of that child ending, not
as misbehaviour by the child. It SHALL NOT terminate anything, SHALL NOT be
recorded as a protocol violation, and SHALL NOT count towards the crash
threshold. A frame refused because it exceeds the message limit SHALL remain a
protocol violation, and the two SHALL be distinguishable in the recorded
diagnostic.

#### Scenario: Write after the child has gone

- **WHEN** the host tries to write to a child whose channel has closed
- **THEN** nothing is terminated, no crash is counted, and the record names a
  closed channel rather than a size limit

#### Scenario: Frame over the message limit

- **WHEN** the host tries to write a frame larger than the message limit
- **THEN** it is treated as a protocol violation and the record names the size
  limit

### Requirement: One child death counts once

A single child ending SHALL count as one failure against the crash threshold
however many pending operations discover it. Work that was in flight when the
child died SHALL NOT each open a new failure. The crash threshold SHALL remain
a measure of repeated deaths over time rather than of how many callers
observed one death.

#### Scenario: Many operations in flight when a child dies

- **WHEN** a child dies while several acknowledgements or replies are still
  pending
- **THEN** exactly one failure is counted and the extension is not quarantined
  by that single death

#### Scenario: Repeated deaths still quarantine

- **WHEN** a child dies repeatedly within the crash window
- **THEN** each death counts once and the extension is quarantined on reaching
  the threshold

### Requirement: The reported exit status is the one the system gave

The exit code or terminating signal the operating system reported for an
extension child SHALL be recorded whenever it is observed. Host-initiated
teardown SHALL NOT replace an observed exit status with one of its own, so a
diagnostic reader can tell how a child actually ended.

#### Scenario: Child exits on its own

- **WHEN** a child exits without being asked to
- **THEN** the recorded exit code or signal is the one the operating system
  reported

#### Scenario: Host terminates an unresponsive child

- **WHEN** the host terminates a child itself
- **THEN** that is recorded as the host's own termination and does not
  overwrite an exit status already observed for that child

### Requirement: Shutdown sequence

Shutdown SHALL stop new admissions, cancel bounded work, call deactivate, then
terminate an unresponsive child. Disabling or replacing code MUST NOT stop or
delete external resources implicitly.

#### Scenario: Unresponsive child at shutdown

- **WHEN** an extension child does not respond to deactivate
- **THEN** it is terminated after admissions stop and bounded work is cancelled

#### Scenario: Disabling a provider with external resources

- **WHEN** an extension managing external resources is disabled or replaced
- **THEN** those external resources are not stopped or deleted implicitly

### Requirement: Self-contained sterile npm installer

Every server distribution SHALL include the pinned npm installer compatible with
the repository's Node and npm versions. Extension support MUST NOT depend on a
system Node, npm, compiler, shell profile, or user configuration. npm SHALL run
through a sterile Terminay-owned configuration fixed to the public npmjs registry
and a private directory under the server data root, and MUST NOT inherit the
user's `.npmrc`, tokens, workspace, lifecycle policy, or project working
directory. When the server is embedded in Desktop, the bundled npm CLI SHALL run
through the Electron executable with `ELECTRON_RUN_AS_NODE=1`, and installing an
extension MUST NOT launch another Desktop application instance or window.

#### Scenario: User npm configuration present

- **WHEN** the user has an `.npmrc` with tokens and an alternate registry
- **THEN** installation ignores it and uses the sterile Terminay-owned
  configuration fixed to public npmjs

#### Scenario: Installing under Desktop

- **WHEN** an extension is installed on a Desktop-embedded server
- **THEN** the bundled npm CLI runs with `ELECTRON_RUN_AS_NODE=1` and no second
  Desktop instance or window appears

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

### Requirement: Installation failure, cleanup, and receipts

Failure SHALL leave the prior active version untouched. Staging SHALL be
recoverably cleaned or quarantined after interruption. Receipts SHALL record safe
package, version, registry integrity, lock and inventory hashes, npm version,
permissions, compatibility, and advisory audit and provenance status.

#### Scenario: Interrupted install

- **WHEN** an install is interrupted
- **THEN** the prior active version is untouched and the staging slot is
  recoverably cleaned or quarantined

#### Scenario: Receipt contents

- **WHEN** an install completes
- **THEN** its receipt records package, version, registry integrity, lock and
  inventory hashes, npm version, permissions, compatibility, and advisory audit
  and provenance status

### Requirement: Advisory signature and provenance reporting

Registry signatures and provenance SHALL be verified and displayed when
available, but SHALL be presented as proving package integrity and source
association rather than benign code. Vulnerability and provenance results SHALL be
advisory facts, not claims of Terminay or npm approval.

#### Scenario: Provenance available

- **WHEN** registry provenance is available for a package
- **THEN** it is verified and displayed as an advisory integrity and source fact,
  not as approval

### Requirement: Side-by-side updates

An update SHALL install side-by-side into a new exact slot. It MUST NOT mutate
the active `node_modules` or run `npm update`. Permission expansion SHALL require
fresh confirmation. When active sessions use the provider, activation SHALL wait
for an explicit drain or restart rather than hot-swapping code beneath live PTY
or filesystem state.

#### Scenario: Update while sessions are live

- **WHEN** an update is installed while active sessions use the provider
- **THEN** activation waits for an explicit drain or restart

#### Scenario: Update expands permissions

- **WHEN** an update declares additional permissions
- **THEN** fresh authorized confirmation is required

### Requirement: Rollback slots

The server SHALL retain at least one known-good exact slot. Rollback SHALL probe
and select it atomically and MUST NOT reverse external actions.

#### Scenario: Rollback after a bad update

- **WHEN** the user rolls back an extension
- **THEN** a retained known-good exact slot is probed and selected atomically,
  and no external action is reversed

### Requirement: Extension data migration safety

Extension data SHALL be namespaced and versioned, with a recoverable snapshot
taken before migration. An incompatible data rollback SHALL require explicit
restore or loss confirmation. The active code pointer SHALL change only after a
data migration succeeds. A failed migration SHALL restore the pre-migration
namespace snapshot and SHALL leave the old active slot selected; restart
reconciliation SHALL retain that extension and every dependent project as
explicitly failed or incompatible.

#### Scenario: Migration fails

- **WHEN** an extension data migration fails
- **THEN** the pre-migration namespace snapshot is restored, the old active slot
  stays selected, and the extension and its dependent projects are represented as
  explicitly failed or incompatible after restart

#### Scenario: Incompatible data rollback

- **WHEN** a rollback would leave data incompatible
- **THEN** explicit restore or loss confirmation is required

### Requirement: Disable, uninstall, and retention

Disable SHALL preserve profiles, data, and secret references. Uninstall SHALL be
blocked while the extension is enabled, referenced by profiles or projects,
required by another extension, or in use. Code removal MUST NOT cascade-delete
projects, external resources, credentials, or provider data. An installed
official version MAY be disabled and retained as a rollback floor under the same
slot-retention policy as a custom extension. A release-bundled slot SHALL be an
immutable rollback floor: it MAY be disabled or superseded by a compatible
external slot but MUST NOT be physically removed from that release.

#### Scenario: Uninstall blocked

- **WHEN** the user uninstalls an extension that is enabled, referenced, required
  by another extension, or in use
- **THEN** the uninstall is blocked and its dependants are listed

#### Scenario: Disabled provider projects

- **WHEN** a provider is disabled or incompatible
- **THEN** the projects that used it remain represented and the extension is
  shown explicitly as disabled or incompatible

#### Scenario: Release-bundled slot removal

- **WHEN** removal of a release-bundled slot is attempted
- **THEN** it is refused; the slot may only be disabled or superseded

### Requirement: Scoped secret brokerage

Secret values SHALL live only in the Terminay Server vault. References SHALL be
owned by `{extensionId, profileId, fieldId/purpose}`. An extension MUST NOT
enumerate the vault or resolve another binding. The broker SHALL recheck
extension and profile ownership and operation permission each time, SHALL send
only the scoped transient copy over private IPC, and SHALL zeroize its
server-side copy afterward. UI, snapshots, events, audit, diagnostics, errors,
manifests, argv, and environment variables SHALL contain metadata only.

#### Scenario: Cross-extension secret resolution

- **WHEN** an extension requests a secret bound to another extension or profile
- **THEN** the request fails closed

#### Scenario: Secret exposure surfaces

- **WHEN** UI, snapshots, events, audit records, diagnostics, errors, manifests,
  argv, or environment variables are produced
- **THEN** they contain secret metadata only

### Requirement: Honest secret-retention warning

Because extension code is trusted, a permitted extension MAY retain or exfiltrate
a secret it receives. The installation warning SHALL communicate that truth rather
than promising sandbox protection.

#### Scenario: Warning shown before granting secret access

- **WHEN** an extension requesting secret access is installed
- **THEN** the warning states that the extension can retain or exfiltrate secrets
  it receives

### Requirement: Transport-bound server permissions

Transport-bound server permissions SHALL separately cover extension management,
profile management and use, secret management, and provider lifecycle and
destructive actions. A client-asserted id or admin scope MUST NOT be accepted.
Revoking the initiating principal SHALL cancel its in-flight administrative
command before activation when possible, and MUST NOT silently destroy shared
provider state.

#### Scenario: Forged admin scope

- **WHEN** a client asserts an id or admin scope it does not hold
- **THEN** it cannot install code or manage profiles, and audit records the
  authenticated transport principal

#### Scenario: Principal revoked mid-install

- **WHEN** the initiating principal is revoked during an administrative command
- **THEN** the in-flight command is cancelled before activation when possible and
  shared provider state is not destroyed

### Requirement: Extensions as a Settings section

Extensions SHALL be a first-class **Extensions** section inside **Settings**,
using the same navigation, header, spacing, controls, responsive behaviour, and
native-window chrome as every other Settings section. They MUST NOT be presented
in a project-editor sheet, a bespoke full-screen modal, or a second list and
detail application nested inside Settings. Providers SHALL use ordinary Settings
groups, rows, fields, buttons, badges, and disclosure patterns.

#### Scenario: Rendering the Extensions section

- **WHEN** Extensions is opened on Desktop or in a browser
- **THEN** it renders as a normal Settings section with no Extensions-specific
  modal or project-editor sheet

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

### Requirement: Extensions entry points

**File → Extensions…** and the Command Bar action SHALL open or focus Settings at
its **Extensions** section. On Desktop this SHALL use the established Settings
auxiliary window; in a browser it SHALL use the established in-page Settings
route and select the same section. Repeated invocation SHALL focus the existing
Settings presentation rather than stacking another dialog.

#### Scenario: Repeated invocation

- **WHEN** an Extensions entry point is invoked while Settings is already open
- **THEN** the existing Settings presentation is focused at the Extensions section
  and no additional dialog is stacked

#### Scenario: Same section from every entry point

- **WHEN** the user opens Extensions from the File menu or the Command Bar
- **THEN** both focus the same selected-server Settings section with the
  established Settings visual and window behaviour

### Requirement: Custom installation review and confirmation

Custom installation SHALL display exact package and version, publisher and
maintainers, repository, registry integrity, provenance and audit information when
available, declared API, permissions, and capabilities, dependency footprint, and
the warning that this is third-party trusted code which runs on the selected
Terminay Server and can access files and networks available to that server
account. The user SHALL confirm against the named selected server. Installation
and activation progress SHALL remain resumable server operations.

#### Scenario: Reviewing a custom package

- **WHEN** a custom package preview is shown
- **THEN** it displays package identity, publisher, repository, integrity,
  provenance and audit facts where available, declared API, permissions and
  capabilities, dependency footprint, and the trusted-code warning naming the
  selected server

#### Scenario: Resumable progress

- **WHEN** the client reconnects during installation or activation
- **THEN** the server operation's progress resumes rather than restarting

### Requirement: Extension actions and blocked-action reporting

Actions SHALL include enable, disable, explicit update, rollback, restart, and
uninstall, with dependants listed when an action is blocked.

#### Scenario: Blocked action

- **WHEN** an action is blocked by a dependant extension or project
- **THEN** the blocking dependants are listed

### Requirement: Merged catalogue and installed records

Official catalogue and installed records SHALL be merged by canonical extension
identity, so one extension never appears as separate Available and Installed
cards. A successful install SHALL replace its review panel with an explicit
success result rather than leaving the spent confirmation visible.

#### Scenario: Installed official extension

- **WHEN** an official catalogue extension is installed
- **THEN** it appears as one card, not as separate Available and Installed entries

#### Scenario: After a successful install

- **WHEN** an install completes successfully
- **THEN** the review panel is replaced by an explicit success result

### Requirement: Public agent-extension harness and third-party author example

The public SDK SHALL ship an in-memory session-source test harness and a documented author example. The repository SHALL contain a minimal third-party session-source extension package that is not derived from an official one. That package SHALL build, pack, activate, and pass conformance using only the public SDK. Generated API reference material SHALL document every snapshot bound, the reset, upsert, and removal ordering guarantees, the harness-switch rules, and the error classes needed to build, test, package, and diagnose a session source without reading Terminay source.

#### Scenario: Third-party fixture extension

- **WHEN** the independent third-party session-source fixture is packed and activated
- **THEN** it registers a source and publishes session snapshots using only the public SDK

#### Scenario: Author documentation completeness

- **WHEN** an author consults the generated API reference
- **THEN** it documents snapshot bounds, ordering guarantees, harness-switch rules, and error classes for a session source

### Requirement: Author SDK entry shape

An extension package SHALL declare its runtime behaviour through a
default-exported extension definition with an `activate` callback that receives
an extension context. Everything Terminay grants to an extension SHALL arrive
through that context or through a callback argument; the API SHALL NOT expose a
global Terminay singleton an extension can reach for. The manifest SHALL declare
only what the package contributes and SHALL NOT contain executable callbacks;
callbacks SHALL be registered at activation.

#### Scenario: Extension activates

- **WHEN** Terminay activates an installed extension
- **THEN** it calls the package's exported `activate` with an extension context
  carrying every grant that extension has

#### Scenario: Reaching for a global

- **WHEN** an extension attempts to obtain Terminay services other than through
  its context or a callback argument
- **THEN** no such global exists and the attempt fails

#### Scenario: Executable manifest entry

- **WHEN** a manifest declares a contribution
- **THEN** the declaration is data only, and the matching callback is supplied
  at activation

### Requirement: Registration is bound to declared contributions

Registering a session source, MCP install target, or language server SHALL be accepted only for an id the registering package's own manifest declares. A registration made under an id the package does not declare, or under another package's namespace, SHALL be refused.

#### Scenario: Undeclared provider id

- **WHEN** an extension registers a contribution under an id its manifest does not
  declare
- **THEN** the registration is refused

#### Scenario: Declared provider id

- **WHEN** an extension registers a contribution under an id its manifest declares
- **THEN** the registration is accepted and returns a disposable registration

### Requirement: Disposable registrations and host-driven cleanup

Every registration returned by the API SHALL be disposable. An extension SHALL
be able to add disposables to the context's subscription set, and Terminay SHALL
dispose that set automatically when the extension is disabled, updated, shut
down, or when its extension host fails. An author SHALL NOT be required to
coordinate client subscriptions, reconnects, or disablement to release
resources.

#### Scenario: Extension disabled

- **WHEN** an extension is disabled, updated, shut down, or its host fails
- **THEN** Terminay disposes everything the extension added to its context
  subscription set

#### Scenario: Author-managed teardown

- **WHEN** an author adds a registration to the context subscription set
- **THEN** no further teardown coordination is required of the extension for
  that registration

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

### Requirement: Extension dependencies are declared, not imported

Extension dependencies SHALL be distinct from npm library dependencies. A
dependent extension SHALL declare a compatible extension dependency; it MUST NOT
import the other extension's internals, duplicate its transport, or silently
install another extension without administrator confirmation.

#### Scenario: Declared extension dependency

- **WHEN** an extension requires functionality another extension owns
- **THEN** it declares a compatible extension dependency and does not import that
  extension's internals or duplicate its transport

#### Scenario: Implicit dependency install

- **WHEN** installing an extension would require installing another extension
- **THEN** it is not installed silently without administrator confirmation

### Requirement: Node APIs and the terminal-evidence boundary

An extension MAY use public Node.js APIs and its declared npm dependencies, native ones included, for ordinary work on the Terminay Server account. Nothing an extension reports SHALL be treated as terminal identity. Terminal binding SHALL be decided by the host from process ancestry. An extension MUST NOT import a private Terminay module to obtain internal services.

#### Scenario: Reading extension preferences

- **WHEN** an extension reads its own configuration file from the Terminay
  Server account with Node APIs
- **THEN** the read is permitted

#### Scenario: Establishing terminal evidence

- **WHEN** a session source reports a session
- **THEN** the host, not the extension, decides which terminal, if any, it binds to

### Requirement: Language server contribution and registration

A language server contribution SHALL declare a namespaced language server id, the
language ids it serves, the file selectors it matches, a display name, and the
runtime notes Settings shows for it. At activation the extension SHALL register
that contribution with a `launch` callback that, given a project root, returns the
argv, cwd policy, environment, and optional initialisation options for the
language server. The host SHALL own everything else: spawning the language server
as a child of the extension process with the project root as its working
directory, stdio framing, initialise, lifecycle, deadlines, and translation into
core's bounded DTOs. A language server extension SHALL contribute no UI, register
no protocol operations, and never enter the renderer.

#### Scenario: Registering a declared language server

- **WHEN** an extension registers a language server id its manifest contributed,
  supplying a `launch` callback
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Undeclared language server id

- **WHEN** an extension registers a language server id its manifest did not
  contribute, or registers the same id twice
- **THEN** the registration is refused

#### Scenario: Host owns the language server process

- **WHEN** a language session starts for a project
- **THEN** the host spawns the language server as a child of the extension process
  with the project root as its working directory and owns its stdio framing,
  initialise, lifecycle, deadlines, and translation

### Requirement: Language session lifecycle in the extension host

Language sessions SHALL be counted and reaped as child resources of the
extension that contributed them, under the same supervision, cancellation, and
shutdown rules as the extension's other bounded work. A language server child
that dies SHALL count against that extension's crash accounting exactly once.
When an extension is quarantined, disabled, or shut down, its language sessions
SHALL end and their pending and subsequent requests SHALL return a typed
unavailable outcome.

#### Scenario: Language server child dies

- **WHEN** a language server child process exits unexpectedly
- **THEN** the death counts once against the contributing extension's crash
  accounting and the diagnostic history records it

#### Scenario: Extension quarantined

- **WHEN** a language server extension is quarantined or disabled
- **THEN** its language sessions end and requests for them return a typed
  unavailable outcome

#### Scenario: Shutdown

- **WHEN** the extension host shuts down
- **THEN** its language sessions are cancelled and their language server children
  are terminated with the extension's other bounded work

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

### Requirement: Worktree observation permission

A worktree insight source SHALL declare the `worktree-observation` permission.
The permission SHALL authorize receiving host-issued repository contexts and
publishing worktree properties and sign-in requests for them, and MUST NOT grant
client authority, workspace navigation, or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** an extension registers a worktree insight source without declaring
  `worktree-observation`
- **THEN** the registration is refused

### Requirement: Host-issued repository context

For each open project whose root is a Git repository, Terminay SHALL issue each
registered worktree insight source a repository context containing the
repository root, its remotes with names and URLs, its worktrees with an
opaque worktree id, path, branch, upstream, and head commit, and whether a
client has the project active. Terminay SHALL re-issue the context when the
worktree set, any worktree's branch, upstream, or head, or the project's
activity changes, and SHALL cancel the context when the project closes, the
extension is disabled, or its host fails. Terminay SHALL accept worktree
properties only for worktree ids in a context it has issued and not cancelled.

#### Scenario: Project opened

- **WHEN** a project whose root is a Git repository is opened
- **THEN** each registered worktree insight source receives its repository
  context

#### Scenario: Branch pushed

- **WHEN** a push updates a worktree's upstream ref
- **THEN** the repository context is re-issued with the new upstream and head

#### Scenario: Publication for an unissued worktree

- **WHEN** an extension publishes properties for a worktree id outside any
  context issued to it
- **THEN** the publication is rejected

#### Scenario: Project closed

- **WHEN** the last client closes a project
- **THEN** its repository context's cancellation signal fires

### Requirement: Sign-in requests and per-origin credentials

A worktree insight source SHALL be able to request sign-in for an HTTPS origin,
supplying a provider name and an optional guarded token-page link, and SHALL be
able to resolve the credential stored for that origin through the scoped vault
broker. Vault bindings for sign-in SHALL be owned by the extension and the
origin; an extension MUST NOT resolve a binding owned by another extension. An
extension SHALL be able to report that a stored credential was rejected, which
removes the binding and permits a new sign-in request.

#### Scenario: Resolving an own-origin credential

- **WHEN** an extension resolves the credential it holds for an origin
- **THEN** it receives a transient copy through the scoped vault broker

#### Scenario: Rejected credential

- **WHEN** an extension reports that the stored credential for an origin was
  rejected by that origin
- **THEN** the binding is removed and a new sign-in prompt may be shown

### Requirement: A long write queue is not a lost frame

A write to an extension channel that the channel accepted and queued SHALL be
treated as sent, on both the host and the child, even when the channel reports
that its write queue is long. Only a frame the channel refused, because it
cannot be serialized, exceeds the message limit, has no connected channel, or
was rejected by the operating system, SHALL be treated as not delivered. A
child that cannot deliver a frame SHALL say which frame and why in the error
it reports.

#### Scenario: Burst of lifecycle publications

- **WHEN** an agent provider publishes lifecycle events faster than the host
  drains its channel
- **THEN** the child keeps running, every queued frame is delivered, and no
  closed channel is recorded

#### Scenario: A frame is refused

- **WHEN** a child cannot deliver a frame to its host
- **THEN** the reported error names the frame kind and the reason it was
  refused
