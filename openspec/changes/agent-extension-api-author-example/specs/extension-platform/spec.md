## ADDED Requirements

### Requirement: Author SDK entry shape

An extension package SHALL declare its runtime behaviour through a default-exported extension definition with an `activate` callback that receives an extension context. Everything Terminay grants to an extension SHALL arrive through that context or through a callback argument; the API SHALL NOT expose a global Terminay singleton an extension can reach for. The manifest SHALL declare only what the package contributes and SHALL NOT contain executable callbacks; callbacks SHALL be registered at activation.

#### Scenario: Extension activates

- **WHEN** Terminay activates an installed extension
- **THEN** it calls the package's exported `activate` with an extension context carrying every grant that extension has

#### Scenario: Reaching for a global

- **WHEN** an extension attempts to obtain Terminay services other than through its context or a callback argument
- **THEN** no such global exists and the attempt fails

#### Scenario: Executable manifest entry

- **WHEN** a manifest declares a contribution
- **THEN** the declaration is data only, and the matching callback is supplied at activation

### Requirement: Registration is bound to declared contributions

Registering a provider SHALL be accepted only for an id the registering package's own manifest declares. A registration made under an id the package does not declare, or under another package's namespace, SHALL be refused.

#### Scenario: Undeclared provider id

- **WHEN** an extension registers a provider under an id its manifest does not declare
- **THEN** the registration is refused

#### Scenario: Declared provider id

- **WHEN** an extension registers a provider under an id its manifest declares
- **THEN** the registration is accepted and returns a disposable registration

### Requirement: Disposable registrations and host-driven cleanup

Every registration returned by the API SHALL be disposable. An extension SHALL be able to add disposables to the context's subscription set, and Terminay SHALL dispose that set automatically when the extension is disabled, updated, shut down, or when its extension host fails. An author SHALL NOT be required to coordinate client subscriptions, reconnects, or disablement to release resources.

#### Scenario: Extension disabled

- **WHEN** an extension is disabled, updated, shut down, or its host fails
- **THEN** Terminay disposes everything the extension added to its context subscription set

#### Scenario: Author-managed teardown

- **WHEN** an author adds a registration to the context subscription set
- **THEN** no further teardown coordination is required of the extension for that registration

### Requirement: Terminal-scoped handles are opaque and non-transferable

File and process handles supplied through a terminal observation context SHALL be opaque values scoped to the terminal context that issued them. Terminay SHALL validate that every handle an extension references was issued by that same terminal context, and SHALL refuse a handle reused with another terminal context or synthesised by the extension. Path resolution helpers SHALL apply the selected project environment's path rules rather than the server host's.

#### Scenario: Handle reused across terminals

- **WHEN** an extension passes a handle issued for one terminal context into another terminal context
- **THEN** the call is refused

#### Scenario: Environment-appropriate resolution

- **WHEN** an extension canonicalises a file handle through the observation API
- **THEN** resolution applies the terminal's project-environment path rules, backed by the server host's filesystem on **This server** and by the environment's advertised capability otherwise

### Requirement: Node APIs and the observation boundary

An extension MAY use public Node.js APIs and its declared npm dependencies for ordinary work on the Terminay Server account. Such access SHALL NOT constitute terminal identity evidence on its own and SHALL NOT reach a non-local project environment's filesystem or process tree. An operation that must target the terminal's project environment SHALL use the observation API. An extension MUST NOT import a private Terminay module to obtain internal services.

#### Scenario: Reading extension preferences

- **WHEN** an extension reads its own configuration file from the Terminay Server account with Node APIs
- **THEN** the read is permitted and is not accepted as terminal identity evidence

#### Scenario: Targeting a remote project environment

- **WHEN** an extension needs evidence from a terminal whose project environment is not **This server**
- **THEN** it must use the observation API, because Node filesystem access reaches only the server host

### Requirement: Cancellation and disposal on every long-running API

Each terminal observation context SHALL carry a cancellation signal that fires when the foreground process leaves, the terminal closes, the environment changes, or the extension is disabled. Every long-running API SHALL accept that signal, and watchers SHALL be asynchronously disposable and idempotent to close.

#### Scenario: Foreground process leaves

- **WHEN** the observed process exits, the terminal closes, the environment changes, or the extension is disabled
- **THEN** the terminal context's cancellation signal fires and every long-running call it was passed to stops

#### Scenario: Closing a watcher twice

- **WHEN** a watcher is closed more than once
- **THEN** the close is idempotent and raises no error

### Requirement: Public conformance test harness

`@terminay/extension-api` SHALL publish a testing entry point providing an extension harness and terminal fixtures. A package SHALL be able to drive its complete provider mapping and assert the canonical events produced without importing Server Core or any other private Terminay module. The harness SHALL check agreement between manifest and registration, value bounds, cancellation, terminal session scope, lifecycle validity, and privacy exclusions.

#### Scenario: Testing a mapping

- **WHEN** a package runs its mapping against a fixture terminal through the public harness
- **THEN** it asserts the canonical lifecycle events produced without importing Server Core

#### Scenario: Harness conformance checks

- **WHEN** a package is exercised through the harness
- **THEN** manifest and registration agreement, bounds, cancellation, session scope, lifecycle validity, and privacy exclusions are checked

### Requirement: Host-owned behaviours excluded from extension authorship

Sidebar components and styling, project and terminal navigation, client subscriptions and remote transport, acknowledgement and unread behaviour, canonical event ordering and replay rejection, extension enable and disable surfaces, extension process lifetime and crash backoff, and Electron-versus-standalone packaging SHALL be owned by Terminay. An extension SHALL supply only provider knowledge and canonical lifecycle facts, and the API SHALL offer it no means of implementing those host behaviours.

#### Scenario: Extension attempts a host behaviour

- **WHEN** an extension attempts to render sidebar UI, navigate the workspace, manage client subscriptions, or order canonical events
- **THEN** no such API is available to it

#### Scenario: Provider responsibilities

- **WHEN** an agent provider package is authored
- **THEN** it implements executable recognition, process-to-session binding evidence, provider home and journal resolution, supported mapping versions, title and model sources, lifecycle and subagent mappings, privacy exclusions, and honest fallback, and nothing else
