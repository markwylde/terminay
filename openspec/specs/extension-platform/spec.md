# extension-platform Specification

## Purpose

Define how npm-distributed, server-installed extension packages add
project-environment and coding-agent providers to a selected Terminay Server,
covering their manifest contract, public API, declarative UI contributions,
isolated host lifecycle, transactional installation, secrets, and permissions.

## Requirements

### Requirement: Extensions execute only on the selected server

Terminay extensions SHALL be npm-distributed, server-installed packages that add
project-environment or coding-agent providers. They SHALL execute only on the
selected Terminay Server. Desktop and browser clients SHALL render bounded
declarative contributions from the server's matching UI bundle and MUST NOT load
extension code.

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

The public API SHALL support the capabilities needed by the official SSH, Puzed,
Codex, Claude Code, Cursor Agent, Grok, and omp extensions. Themes, editor
plugins, autocomplete, arbitrary commands, renderer components, and generic
Server Core operation registration SHALL be out of scope.

#### Scenario: Unsupported contribution kind

- **WHEN** a package declares a theme, editor plugin, autocomplete source,
  arbitrary command, renderer component, or generic Server Core operation
- **THEN** the contribution is not supported and validation rejects it

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

Terminay SHALL ship an official catalogue containing the built-in SSH, Puzed,
Codex, Claude Code, Cursor Agent, Grok, and omp npm packages and their expected
metadata. Verified package artifacts for that exact release SHALL be embedded in
Electron and standalone server distributions, installed without network access,
and enabled by default. Official packages SHALL use the same public manifest,
extension host, broker, and compatibility checks as custom packages. The
**Official** badge SHALL be catalogue metadata, not a privileged runtime tier.

#### Scenario: Offline first start

- **WHEN** a server starts with no network access
- **THEN** its release-bundled official extensions are installed from embedded
  verified artifacts and enabled by default

#### Scenario: Built-in has no private access

- **WHEN** a built-in package activates
- **THEN** it passes the same public manifest, host, broker, and compatibility
  contract as a custom package and receives no private API access

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

Archive traversal, absolute paths, links, non-regular entries, duplicate package
manifests, excess entry or unpacked-size bounds, malformed gzip or tar data,
lifecycle or native build requirements, and a materialized manifest that differs
from preview SHALL fail closed before extension code is imported.

#### Scenario: Traversal entry in an archive

- **WHEN** an uploaded archive contains a traversal path, absolute path, link,
  non-regular entry, duplicate manifest, or malformed data
- **THEN** the install fails before any extension code is imported

#### Scenario: Materialized manifest differs from preview

- **WHEN** the materialized manifest does not match the confirmed preview
- **THEN** the install fails closed

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

One npm package SHALL contribute one immutable extension identity. Its
`package.json` SHALL contain a closed, runtime-validated `terminay` object with a
`manifestVersion`; a globally collision-resistant immutable extension id; a
display name and bounded description; a Terminay Extension API range and Terminay
and Node engine compatibility; one relative ESM entrypoint exported inside the
package; declared permissions; Terminay extension dependencies and compatible
contribution ranges; and namespaced project-environment and coding-agent provider
contributions.

#### Scenario: Closed manifest object

- **WHEN** the `terminay` object contains an unknown field
- **THEN** validation fails before import

#### Scenario: Valid manifest

- **WHEN** a package declares every required manifest field within its bounds
- **THEN** the package passes manifest validation

### Requirement: Contribution arrays

`contributes.projectEnvironments` and `contributes.agentProviders` SHALL be
independently optional arrays, and at least one supported contribution SHALL be
required. An agent package MUST NOT be required to register a project
environment merely to satisfy the manifest.

#### Scenario: Agent-only package

- **WHEN** a package contributes only agent providers
- **THEN** it validates without declaring a project environment

#### Scenario: No contributions

- **WHEN** a package declares neither contribution array
- **THEN** validation fails

### Requirement: Server-derived provider registration

An activated project-environment contribution SHALL register its declared
capabilities with the selected server's environment router. The server SHALL
derive this registration from the activated manifest and extension pair. Desktop,
standalone composition, and generic Server Core MUST NOT name an extension or
provider id.

#### Scenario: Registration source

- **WHEN** an extension activates
- **THEN** its provider registration is derived from the activated manifest and
  extension pair, with no host or composition code naming that provider id

### Requirement: Explicit environment creation on profile save

A contribution MAY opt into `profileSave: { createEnvironment: true }`. Saving a
profile otherwise SHALL persist only the profile. The opt-in SHALL create one
environment bound to the just-saved profile and SHALL call the public
`createEnvironment` callback. This behaviour MUST NOT be inferred from a provider
id, form, or capability.

#### Scenario: Provider without the opt-in

- **WHEN** a profile is saved for a contribution that has not opted in
- **THEN** only the profile is persisted and no environment is created

#### Scenario: Provider with the opt-in

- **WHEN** a profile is saved for a contribution declaring
  `profileSave: { createEnvironment: true }`
- **THEN** one environment bound to that just-saved profile is created through
  the public `createEnvironment` callback

### Requirement: Identity separation and namespacing

Package name and extension id SHALL be separate so repository or package
ownership can change without breaking persisted environment identities. Provider,
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

### Requirement: Public extension API capabilities

The API SHALL permit an extension to define redacted profile and environment
types and project-environment provider capabilities; contribute declarative
profile, create, browse, status, progress, confirmation, and lifecycle surfaces;
receive its own namespaced configuration, data, and cache directories; request
resolution of its own profile-bound secret fields through a scoped broker; make
bounded provider-dependency calls; implement provider runtime callbacks through
bounded typed IPC with cancellation, deadlines, and concurrency limits;
contribute a coding-agent provider and register its provider-specific observation
runtime; use a terminal-scoped, environment-routed observation broker for bounded
process, TTY, open-file, realpath, stat, read, and append or replace evidence;
and publish validated provider-neutral root, turn, tool, wait, model, completion,
exit, and subagent lifecycle events to the host-owned canonical projection.

#### Scenario: Provider dependency call

- **WHEN** the Puzed extension asks the SSH extension to validate or open an
  environment
- **THEN** the bounded provider-dependency call is made through the public
  provider contract

#### Scenario: Runtime callback bounds

- **WHEN** a provider runtime callback runs
- **THEN** it is subject to cancellation, deadlines, and concurrency limits over
  bounded typed IPC

#### Scenario: Publishing agent lifecycle events

- **WHEN** an agent provider publishes root, turn, tool, wait, model, completion,
  exit, or subagent events
- **THEN** they are validated and written to the host-owned canonical projection

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

An agent provider SHALL declare the `agent-observation` permission and each
required environment observation capability. The permission SHALL authorize
agent-context delivery and canonical publication, and MUST NOT grant client
authority or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** a provider publishes agent events without declaring
  `agent-observation`
- **THEN** the publication is refused

#### Scenario: Permission scope

- **WHEN** `agent-observation` is granted
- **THEN** it authorizes agent-context delivery and canonical publication only

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

### Requirement: Environment-appropriate observation

For This server, an agent extension MAY combine its host-issued terminal context
with Node process and filesystem APIs. For SSH and other non-local environments,
local Node APIs MUST NOT establish remote terminal or journal identity; the
extension SHALL use the environment-routed observation broker when the
environment advertises that capability. The host SHALL accept canonical events
only for the terminal context it issued.

#### Scenario: Remote environment observation

- **WHEN** an agent extension observes a terminal in an SSH environment
- **THEN** it uses the environment-routed observation broker rather than local
  Node APIs to establish terminal or journal identity

#### Scenario: Event for an unissued terminal context

- **WHEN** an extension publishes a canonical event for a terminal context the
  host did not issue
- **THEN** the event is rejected

### Requirement: Extension dependencies are distinct from npm dependencies

Extension dependencies SHALL be distinct from npm library dependencies. A
dependent extension SHALL declare a compatible extension dependency and call its
public provider contract; it MUST NOT import the other extension's internals,
duplicate its transport, or silently install another extension without
administrator confirmation.

#### Scenario: Puzed depends on SSH

- **WHEN** Puzed requires SSH functionality
- **THEN** it declares a compatible SSH extension dependency and calls its public
  provider contract without importing SSH internals

#### Scenario: Implicit dependency install

- **WHEN** installing an extension would require installing another extension
- **THEN** it is not installed silently without administrator confirmation

### Requirement: Declarative UI contribution surface

Extension code MUST NOT enter the renderer. Fixed `extensions.*` and
`project-environments.*` application-protocol operations SHALL return bounded
schemas and safe status data. The server-bundled generic UI SHALL support
sections and accessible disclosures; text, number, URL, secret, checkbox, switch,
and textarea fields; searchable asynchronous selectors with deadlines and
cancellation; radio-like preset cards; conditional visibility and disabled
reasons; inline validation plus an error summary; progress stages and resumable
operation status; ordinary and destructive confirmations; and guarded
credential-free HTTPS links.

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

- **WHEN** the same contribution schema renders for SSH, Puzed, or a third-party
  provider on Desktop or in a browser
- **THEN** it looks native to Terminay through the shared Settings primitives

### Requirement: Activation is required for successful installation

An enabled extension MUST NOT be treated as successfully installed merely because
its package passes a probe. After the immutable slot is committed, the Terminay
Server SHALL activate that exact slot and SHALL keep its provider process
running. On server startup every enabled, compatible active slot SHALL be
restored before provider catalogues are served. Activation failure SHALL be
represented explicitly and MUST NOT fall back to This server.

#### Scenario: Startup restore order

- **WHEN** the server starts
- **THEN** every enabled compatible active slot is restored before provider
  catalogues are served

#### Scenario: Activation fails

- **WHEN** activation of an extension fails
- **THEN** the failure is represented explicitly and its environments do not fall
  back to This server

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

One crash SHALL mark only that extension and its environments unavailable. It
MUST NOT prevent This server readiness or crash another provider.

#### Scenario: Provider crash

- **WHEN** an extension host process crashes
- **THEN** only that extension and its environments are marked unavailable, and
  This server and other providers remain usable

### Requirement: Shutdown sequence

Shutdown SHALL stop new admissions, cancel bounded work, call deactivate, then
terminate an unresponsive child. Disabling or replacing code MUST NOT stop or
delete external virtual machines implicitly.

#### Scenario: Unresponsive child at shutdown

- **WHEN** an extension child does not respond to deactivate
- **THEN** it is terminated after admissions stop and bounded work is cancelled

#### Scenario: Disabling a provider with external resources

- **WHEN** an extension managing external VMs is disabled or replaced
- **THEN** those external VMs are not stopped or deleted implicitly

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

Installation SHALL resolve exact package, version, and integrity and fetch
metadata for preview; require an authorized confirmation bound to that preview
digest; create an isolated staging slot and exact lockfile; reject non-npmjs,
git, file, link, or remote dependencies and missing integrity; materialize
production dependencies with lifecycle scripts disabled, development dependencies
omitted, and binary links disabled; reject trees containing native `.node`
modules, `binding.gyp`, or required install lifecycle scripts; validate file,
count, size, symlink, entrypoint, manifest, API, and engine limits and record
package-lock and inventory hashes; atomically promote an immutable
content-addressed version slot; probe it in a fresh extension host; and change
the active pointer only after successful definition and registration.

#### Scenario: Exact package installs cleanly

- **WHEN** a custom exact npm package is installed
- **THEN** it materializes with lifecycle scripts disabled and cannot use a git,
  file, http, or alias specification or a native or install-dependent tree

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
fresh confirmation. When active environments or sessions use the provider,
activation SHALL wait for an explicit drain or restart rather than hot-swapping
code beneath live PTY or filesystem state.

#### Scenario: Update while sessions are live

- **WHEN** an update is installed while active environments or sessions use the
  provider
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

Disable SHALL preserve profiles, environment records, data, and secret
references. Uninstall SHALL be blocked while the extension is enabled, referenced
by profiles or projects, required by another extension, or in use. Code removal
MUST NOT cascade-delete projects, external resources, credentials, or provider
data. An installed official version MAY be disabled and retained as a rollback
floor under the same slot-retention policy as a custom extension. A
release-bundled slot SHALL be an immutable rollback floor: it MAY be disabled or
superseded by a compatible external slot but MUST NOT be physically removed from
that release.

#### Scenario: Uninstall blocked

- **WHEN** the user uninstalls an extension that is enabled, referenced, required
  by another extension, or in use
- **THEN** the uninstall is blocked and its dependants are listed

#### Scenario: Disabled provider projects

- **WHEN** a provider is disabled or incompatible
- **THEN** its projects remain represented and never fall back to Local

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
environment and profile management and use, secret management, SSH trust
override, and provider lifecycle and destructive actions. A client-asserted id or
admin scope MUST NOT be accepted. Revoking the initiating principal SHALL cancel
its in-flight administrative command before activation when possible, and MUST NOT
silently destroy shared environments.

#### Scenario: Forged admin scope

- **WHEN** a client asserts an id or admin scope it does not hold
- **THEN** it cannot install code or manage profiles, and audit records the
  authenticated transport principal

#### Scenario: Principal revoked mid-install

- **WHEN** the initiating principal is revoked during an administrative command
- **THEN** the in-flight command is cancelled before activation when possible and
  shared environments are not destroyed

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

The Extensions section SHALL name the selected Terminay Server as the authority
and SHALL show built-in SSH, Puzed, Codex, Claude Code, Cursor Agent, Grok, and
omp cards, installed and disabled states, available explicit updates,
compatibility and failure details, permissions, dependants, and **Install from
npm…**.

#### Scenario: Viewing extension state

- **WHEN** the user opens Extensions
- **THEN** the selected server is named as the authority and built-in cards,
  installed and disabled state, available explicit updates, compatibility and
  failure detail, permissions, dependants, and **Install from npm…** are shown

### Requirement: Extensions entry points

**File → Extensions…** and the Command Bar action SHALL open or focus Settings at
its **Extensions** section. The project-bar environment chooser MUST NOT duplicate
that action. On Desktop this SHALL use the established Settings auxiliary window;
in a browser it SHALL use the established in-page Settings route and select the
same section. Repeated invocation SHALL focus the existing Settings presentation
rather than stacking another dialog.

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

Registering a provider SHALL be accepted only for an id the registering
package's own manifest declares. A registration made under an id the package
does not declare, or under another package's namespace, SHALL be refused.

#### Scenario: Undeclared provider id

- **WHEN** an extension registers a provider under an id its manifest does not
  declare
- **THEN** the registration is refused

#### Scenario: Declared provider id

- **WHEN** an extension registers a provider under an id its manifest declares
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

### Requirement: Terminal-scoped handles are opaque and non-transferable

File and process handles supplied through a terminal observation context SHALL
be opaque values scoped to the terminal context that issued them. Terminay SHALL
validate that every handle an extension references was issued by that same
terminal context, and SHALL refuse a handle reused with another terminal context
or synthesised by the extension. Path resolution helpers SHALL apply the
selected project environment's path rules rather than the server host's.

#### Scenario: Handle reused across terminals

- **WHEN** an extension passes a handle issued for one terminal context into
  another terminal context
- **THEN** the call is refused

#### Scenario: Environment-appropriate resolution

- **WHEN** an extension canonicalises a file handle through the observation API
- **THEN** resolution applies the terminal's project-environment path rules,
  backed by the server host's filesystem on **This server** and by the
  environment's advertised capability otherwise

### Requirement: Node APIs and the observation boundary

An extension MAY use public Node.js APIs and its declared npm dependencies for
ordinary work on the Terminay Server account. Such access SHALL NOT constitute
terminal identity evidence on its own and SHALL NOT reach a non-local project
environment's filesystem or process tree. An operation that must target the
terminal's project environment SHALL use the observation API. An extension MUST
NOT import a private Terminay module to obtain internal services.

#### Scenario: Reading extension preferences

- **WHEN** an extension reads its own configuration file from the Terminay
  Server account with Node APIs
- **THEN** the read is permitted and is not accepted as terminal identity
  evidence

#### Scenario: Targeting a remote project environment

- **WHEN** an extension needs evidence from a terminal whose project environment
  is not **This server**
- **THEN** it must use the observation API, because Node filesystem access
  reaches only the server host

### Requirement: Cancellation and disposal on every long-running API

Each terminal observation context SHALL carry a cancellation signal that fires
when the foreground process leaves, the terminal closes, the environment
changes, or the extension is disabled. Every long-running API SHALL accept that
signal, and watchers SHALL be asynchronously disposable and idempotent to close.

#### Scenario: Foreground process leaves

- **WHEN** the observed process exits, the terminal closes, the environment
  changes, or the extension is disabled
- **THEN** the terminal context's cancellation signal fires and every
  long-running call it was passed to stops

#### Scenario: Closing a watcher twice

- **WHEN** a watcher is closed more than once
- **THEN** the close is idempotent and raises no error

### Requirement: Public conformance test harness

`@terminay/extension-api` SHALL publish a testing entry point providing an
extension harness and terminal fixtures. A package SHALL be able to drive its
complete provider mapping and assert the canonical events produced without
importing Server Core or any other private Terminay module. The harness SHALL
check agreement between manifest and registration, value bounds, cancellation,
terminal session scope, lifecycle validity, and privacy exclusions.

#### Scenario: Testing a mapping

- **WHEN** a package runs its mapping against a fixture terminal through the
  public harness
- **THEN** it asserts the canonical lifecycle events produced without importing
  Server Core

#### Scenario: Harness conformance checks

- **WHEN** a package is exercised through the harness
- **THEN** manifest and registration agreement, bounds, cancellation, session
  scope, lifecycle validity, and privacy exclusions are checked

### Requirement: Host-owned behaviours excluded from extension authorship

Sidebar components and styling, project and terminal navigation, client
subscriptions and remote transport, acknowledgement and unread behaviour,
canonical event ordering and replay rejection, extension enable and disable
surfaces, extension process lifetime and crash backoff, and
Electron-versus-standalone packaging SHALL be owned by Terminay. An extension
SHALL supply only provider knowledge and canonical lifecycle facts, and the API
SHALL offer it no means of implementing those host behaviours.

#### Scenario: Extension attempts a host behaviour

- **WHEN** an extension attempts to render sidebar UI, navigate the workspace,
  manage client subscriptions, or order canonical events
- **THEN** no such API is available to it

#### Scenario: Provider responsibilities

- **WHEN** an agent provider package is authored
- **THEN** it implements executable recognition, process-to-session binding
  evidence, provider home and journal resolution, supported mapping versions,
  title and model sources, lifecycle and subagent mappings, privacy exclusions,
  and honest fallback, and nothing else

