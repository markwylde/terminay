## ADDED Requirements

### Requirement: Host-issued terminal context for observation

An agent extension MAY combine its host-issued terminal context with Node
process and filesystem APIs to establish terminal or journal identity. The host
SHALL accept canonical events only for the terminal context it issued.

#### Scenario: Observing a terminal

- **WHEN** an agent extension observes a terminal
- **THEN** it establishes terminal or journal identity from the host-issued
  terminal context together with Node process and filesystem APIs

#### Scenario: Event for an unissued terminal context

- **WHEN** an extension publishes a canonical event for a terminal context the
  host did not issue
- **THEN** the event is rejected

### Requirement: Public extension API capabilities for agent extensions

The API SHALL permit an extension to define redacted profile types; contribute
declarative status, progress, confirmation, and lifecycle surfaces; receive its
own namespaced configuration, data, and cache directories; request resolution of
its own profile-bound secret fields through a scoped broker; implement provider
runtime callbacks through bounded typed IPC with cancellation, deadlines, and
concurrency limits; contribute a coding-agent provider and register its
provider-specific observation runtime; use a terminal-scoped observation broker
for bounded process, TTY, open-file, realpath, stat, read, and append or replace
evidence; and publish validated provider-neutral root, turn, tool, wait, model,
completion, exit, and subagent lifecycle events to the host-owned canonical
projection.

#### Scenario: Runtime callback bounds

- **WHEN** a provider runtime callback runs
- **THEN** it is subject to cancellation, deadlines, and concurrency limits over
  bounded typed IPC

#### Scenario: Publishing agent lifecycle events

- **WHEN** an agent provider publishes root, turn, tool, wait, model, completion,
  exit, or subagent events
- **THEN** they are validated and written to the host-owned canonical projection

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

### Requirement: Terminal-scoped handles are opaque and scoped to one terminal

File and process handles supplied through a terminal observation context SHALL
be opaque values scoped to the terminal context that issued them. Terminay SHALL
validate that every handle an extension references was issued by that same
terminal context, and SHALL refuse a handle reused with another terminal context
or synthesised by the extension. Path resolution helpers SHALL apply the server
host's path rules.

#### Scenario: Handle reused across terminals

- **WHEN** an extension passes a handle issued for one terminal context into
  another terminal context
- **THEN** the call is refused

#### Scenario: Path resolution through the observation API

- **WHEN** an extension canonicalises a file handle through the observation API
- **THEN** resolution applies the server host's filesystem path rules

### Requirement: Node APIs and the terminal-evidence boundary

An extension MAY use public Node.js APIs and its declared npm dependencies for
ordinary work on the Terminay Server account. Such access SHALL NOT constitute
terminal identity evidence on its own. An operation that establishes evidence
about the terminal SHALL use the observation API. An extension MUST NOT import a
private Terminay module to obtain internal services.

#### Scenario: Reading extension preferences

- **WHEN** an extension reads its own configuration file from the Terminay
  Server account with Node APIs
- **THEN** the read is permitted and is not accepted as terminal identity
  evidence

#### Scenario: Establishing terminal evidence

- **WHEN** an extension needs evidence about a terminal it is observing
- **THEN** it uses the observation API rather than an unscoped Node read

## MODIFIED Requirements

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

The public API SHALL support the capabilities needed by the official Codex,
Claude Code, Cursor Agent, Grok, and omp extensions. Themes, editor plugins,
autocomplete, arbitrary commands, renderer components, and generic Server Core
operation registration SHALL be out of scope.

#### Scenario: Unsupported contribution kind

- **WHEN** a package declares a theme, editor plugin, autocomplete source,
  arbitrary command, renderer component, or generic Server Core operation
- **THEN** the contribution is not supported and validation rejects it

### Requirement: Official catalogue and release-bundled artifacts

Terminay SHALL ship an official catalogue containing the built-in Codex, Claude
Code, Cursor Agent, Grok, and omp npm packages and their expected metadata.
Verified package artifacts for that exact release SHALL be embedded in Electron
and standalone server distributions, installed without network access, and
enabled by default. Official packages SHALL use the same public manifest,
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

### Requirement: One package, one immutable extension identity

One npm package SHALL contribute one immutable extension identity. Its
`package.json` SHALL contain a closed, runtime-validated `terminay` object with a
`manifestVersion`; a globally collision-resistant immutable extension id; a
display name and bounded description; a Terminay Extension API range and Terminay
and Node engine compatibility; one relative ESM entrypoint exported inside the
package; declared permissions; Terminay extension dependencies and compatible
contribution ranges; and namespaced coding-agent provider contributions.

#### Scenario: Closed manifest object

- **WHEN** the `terminay` object contains an unknown field
- **THEN** validation fails before import

#### Scenario: Valid manifest

- **WHEN** a package declares every required manifest field within its bounds
- **THEN** the package passes manifest validation

### Requirement: Contribution arrays

`contributes.agentProviders` SHALL be the supported contribution array, and at
least one supported contribution SHALL be required.

#### Scenario: Agent-only package

- **WHEN** a package contributes one or more agent providers
- **THEN** it passes contribution validation

#### Scenario: No contributions

- **WHEN** a package declares no contribution array
- **THEN** validation fails

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

### Requirement: Agent observation permission

An agent provider SHALL declare the `agent-observation` permission. The
permission SHALL authorize agent-context delivery and canonical publication, and
MUST NOT grant client authority or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** a provider publishes agent events without declaring
  `agent-observation`
- **THEN** the publication is refused

#### Scenario: Permission scope

- **WHEN** `agent-observation` is granted
- **THEN** it authorizes agent-context delivery and canonical publication only

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

### Requirement: Crash containment

One crash SHALL mark only that extension unavailable. It MUST NOT prevent server
readiness or crash another provider. Every crash SHALL be recorded in the local
diagnostic history with the extension id, the observed exit code or signal, and
the error the child reported.

#### Scenario: Provider crash

- **WHEN** an extension host process crashes
- **THEN** only that extension is marked unavailable, and the server and other
  providers remain usable

#### Scenario: Crash leaves evidence

- **WHEN** an extension host process crashes
- **THEN** the local diagnostic history records the extension id, the exit code
  or signal, and the reported error

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

### Requirement: Extensions section content

The Extensions section SHALL name the selected Terminay Server as the authority
and SHALL show built-in Codex, Claude Code, Cursor Agent, Grok, and omp cards,
installed and disabled states, available explicit updates, compatibility and
failure details, permissions, dependants, and **Install from npm…**.

#### Scenario: Viewing extension state

- **WHEN** the user opens Extensions
- **THEN** the selected server is named as the authority and built-in cards,
  installed and disabled state, available explicit updates, compatibility and
  failure detail, permissions, dependants, and **Install from npm…** are shown

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

### Requirement: Agent provider registration and terminal-incarnation admission

An extension SHALL register an agent provider at activation through
`context.agents.registerProvider(definition, runtime)`, which SHALL return a
disposable registration. Registration SHALL fail closed for a provider id the
manifest did not contribute, a duplicate provider id, or a registration
attempted after deactivation. Each provider contribution SHALL declare a
namespaced provider id, display metadata, supported platforms, executable and
process matchers, and provider version and mapping declarations. The host SHALL
issue a terminal context bound to the exact server, project, terminal session,
and process incarnation, and SHALL reject publications, acknowledgements,
cancellations, and observation requests that name a stale context, another
terminal, or an undeclared provider. Oversized or malformed host messages SHALL
be rejected without reaching the canonical store.

#### Scenario: Undeclared provider id

- **WHEN** an extension registers a provider id its manifest did not contribute
- **THEN** the registration is refused

#### Scenario: Duplicate registration

- **WHEN** an extension registers the same provider id twice, or registers after
  deactivation
- **THEN** the registration is refused

#### Scenario: Cross-terminal handle

- **WHEN** an extension uses a handle issued for another terminal or a retired
  context
- **THEN** the operation is rejected and nothing is written to the canonical
  store

#### Scenario: Oversized message

- **WHEN** an oversized or malformed message arrives on the extension host
  channel
- **THEN** it is rejected before it reaches the canonical store

### Requirement: Exact-once observer retirement

Terminal exit, provider disable, provider update, project removal, extension
child crash, and server shutdown SHALL each retire the affected observation
contexts exactly once, and a repeated cause SHALL NOT retire them again.
Retirement SHALL cancel the extension's observers and SHALL permit a fresh
admission afterwards. A stalled or crashed retirement for one provider SHALL
leave unrelated providers' contexts usable, and per-extension process isolation
with restart and backoff SHALL be preserved.

#### Scenario: Repeated retirement cause

- **WHEN** the same retirement cause is applied twice to one context
- **THEN** the context is retired exactly once

#### Scenario: Retirement then re-admission

- **WHEN** a context is retired and the terminal matches a provider again
- **THEN** a fresh admission is accepted

#### Scenario: Crashing extension

- **WHEN** one extension's child crashes or stalls during retirement
- **THEN** unrelated providers' contexts remain usable and the crashed extension
  restarts under the ordinary backoff

### Requirement: Terminal-scoped directory list and watch operations

The public observation broker SHALL offer terminal-scoped directory listing and
directory watching for the exact terminal, with bounded results, cancellation,
and atomic-replacement handling. These operations SHALL be available only through
the broker and SHALL NOT read a directory outside the broker-issued scope.

A listing MAY declare the exact filenames it is looking for. Where it does,
only files with those names SHALL be considered, and only they SHALL be charged
against the declared limits, so a caller that already knows the filename it
wants is bounded by that file rather than by everything sharing the directory
with it. Each declared name SHALL be a single path segment; a name that is not
SHALL be refused rather than resolved.

#### Scenario: Bounded directory watch

- **WHEN** an extension watches a directory through the broker
- **THEN** results are bounded, replacement is handled, and cancellation
  disposes the watcher

#### Scenario: Out-of-scope directory

- **WHEN** an extension lists or watches a directory outside its broker-issued
  terminal scope
- **THEN** the request is refused

#### Scenario: Listing that declares the filename it wants

- **WHEN** a listing declares an exact filename and the directory also holds
  files large or numerous enough to exhaust the declared limits
- **THEN** only the declared filename is considered and charged, and the
  listing is not truncated by the files it never asked for

#### Scenario: Declared name that is not a single segment

- **WHEN** a declared name contains a path separator or a traversal segment
- **THEN** the request is refused

### Requirement: Public observation adapters and driver toolkit

The public SDK SHALL define an observation-adapter interface and a driver
toolkit that an extension MAY use to implement a provider: bounded JSONL replay
and follow, incomplete-line buffering, truncation and atomic-replacement
detection including inode or device replacement, over-limit discard,
cancellation helpers, versioned mapping selection, safe string handling, and
canonical event builders with validation. The toolkit SHALL accept public
adapters and plain data so an extension MAY back it with Node APIs or with the
observation broker, and a provider MAY implement another bounded format without
using the toolkit. Diagnostics produced through the toolkit SHALL be typed and
safe to display, carrying no paths, prompts, credentials, native payloads, or
arbitrary provider errors.

#### Scenario: Split record across chunks

- **WHEN** a JSONL record or UTF-8 sequence is split across follow chunks
- **THEN** the toolkit buffers it until complete rather than emitting a partial
  record

#### Scenario: Truncation or replacement

- **WHEN** the observed file is truncated or atomically replaced
- **THEN** the toolkit reports the reset and re-establishes reading

#### Scenario: Unavailable provider diagnostic

- **WHEN** a provider becomes unavailable
- **THEN** a typed diagnostic is produced with no path, prompt, credential,
  native payload, or raw provider error

### Requirement: Cancellation and disposal on every long-running API

Each terminal observation context SHALL carry a cancellation signal that fires
when the foreground process leaves, the terminal closes, or the extension is
disabled. Every long-running API SHALL accept that signal, and watchers SHALL be
asynchronously disposable and idempotent to close.

#### Scenario: Foreground process leaves

- **WHEN** the observed process exits, the terminal closes, or the extension is
  disabled
- **THEN** the terminal context's cancellation signal fires and every
  long-running call it was passed to stops

#### Scenario: Closing a watcher twice

- **WHEN** a watcher is closed more than once
- **THEN** the close is idempotent and raises no error

## REMOVED Requirements

### Requirement: Server-derived provider registration

**Reason:** Project environments are removed; there is no environment router for a contribution to register capabilities with, and agent-provider registration is covered by the agent registration requirement.

**Migration:** None; there are no installed users.

### Requirement: Explicit environment creation on profile save

**Reason:** Project environments are removed; saving a profile has no environment to create.

**Migration:** None; there are no installed users.

### Requirement: Environment-appropriate observation

**Reason:** Project environments are removed; every terminal runs on the server host, so observation has one shape. Replaced by "Host-issued terminal context for observation".

**Migration:** None; there are no installed users.

### Requirement: Target-owned vault references in provider-dependency calls

**Reason:** Provider-dependency calls existed only so one project-environment provider could open another's environment; both the calls and the environments are removed.

**Migration:** None; there are no installed users.

### Requirement: Public extension API capabilities

**Reason:** The environment-provider halves of the API — redacted environment types, project-environment provider capabilities, declarative provider forms, and bounded provider-dependency calls — go with the project environment layer. Replaced by "Public extension API capabilities for agent extensions".

**Migration:** None; there are no installed users.

### Requirement: Extension dependencies are distinct from npm dependencies

**Reason:** Its provider-contract clause and scenarios existed only so one project-environment provider could call another. Replaced by "Extension dependencies are declared, not imported".

**Migration:** None; there are no installed users.

### Requirement: Terminal-scoped handles are opaque and non-transferable

**Reason:** Path resolution no longer selects between a project environment's rules and the server host's. Replaced by "Terminal-scoped handles are opaque and scoped to one terminal".

**Migration:** None; there are no installed users.

### Requirement: Node APIs and the observation boundary

**Reason:** Node APIs can no longer reach past a project environment boundary, because there is none. Replaced by "Node APIs and the terminal-evidence boundary".

**Migration:** None; there are no installed users.
