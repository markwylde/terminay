## ADDED Requirements

### Requirement: Versioned public extension API
Terminay SHALL publish a dependency-light public extension API package carrying the
extension types, runtime schemas, manifest rules, API version rules, namespacing rules, and
a conformance CLI. An extension SHALL declare the API version it targets, and the server
SHALL admit only exactly compatible declarations.

#### Scenario: Conformance check
- **WHEN** an extension package is checked with the conformance CLI
- **THEN** the CLI reports whether its manifest, entrypoint, and contributions satisfy the
  published contract

#### Scenario: Incompatible API version
- **WHEN** an extension declares an API version the server does not support
- **THEN** the server rejects it before importing any of its code

### Requirement: Bounded extension and environment protocol operations
The application protocol SHALL expose a fixed set of `extensions.*` and
`project-environments.*` operations with declared DTOs, policies, permissions, idempotency
keys, revisions, deadlines, and ordered events. Extensions SHALL NOT add protocol operations
of their own.

#### Scenario: Revisioned administrative mutation
- **WHEN** an authorized actor performs an extension or environment administrative mutation
- **THEN** the operation carries a revision, is audited without recording secret values, and
  its effect is idempotent under a repeated idempotency key

#### Scenario: Core operation collision
- **WHEN** an extension attempts to register an operation in the core namespace
- **THEN** registration is rejected and the extension does not become active

### Requirement: Isolated extension child process
Each extension SHALL run in its own server child process launched with the bundled Node
runtime, communicating over private framed IPC with a minimal environment and working
directory, bounded admission, bounded message sizes, bounded timeouts, an explicit shutdown
sequence, and crash-loop control.

#### Scenario: Crash containment
- **WHEN** an extension child crashes or crash-loops
- **THEN** the server and every other extension continue running, and server and This server
  readiness are unaffected

#### Scenario: Late or oversized IPC
- **WHEN** an extension child sends an oversized message or replies after its deadline
- **THEN** the host rejects the message and applies its bounded failure handling rather than
  accepting unbounded input

### Requirement: Bounded extension host surface
An extension SHALL receive only namespaced configuration, data, and cache storage; scoped
logging; scoped secret resolution; provider registration and declared dependency calls;
cancellation; and lifecycle callbacks. No other server capability SHALL be reachable from an
extension child.

#### Scenario: Cross-extension secret denial
- **WHEN** an extension attempts to resolve a secret belonging to another extension
- **THEN** the vault broker denies the request

#### Scenario: Namespaced storage
- **WHEN** an extension writes configuration, data, or cache entries
- **THEN** those entries are confined to that extension's namespace

### Requirement: Manifest and entrypoint validation before import
The server SHALL validate an extension's manifest, entrypoint, declared API version, engine,
platform, and dependencies before importing its code, and SHALL reject unknown fields,
colliding identities, and paths that escape the extension directory.

#### Scenario: Path escape rejected
- **WHEN** a manifest declares an entrypoint that resolves outside the extension directory
- **THEN** the extension is rejected before import

#### Scenario: Colliding identity rejected
- **WHEN** an extension declares an identity already held by an installed extension
- **THEN** the server rejects it and the installed extension is unaffected

### Requirement: Declarative UI contribution surface
Extension user interface contributions SHALL be declared as bounded data — forms, options,
cards, progress, and actions. Renderer code, raw HTML, and arbitrary assets SHALL NOT cross
the extension boundary; client hosts receive schemas and status only.

#### Scenario: Raw markup is rejected
- **WHEN** a contribution declares raw HTML or an executable asset
- **THEN** the contribution is rejected by schema validation

#### Scenario: Client receives schemas only
- **WHEN** a Desktop or browser client renders an extension's provider form
- **THEN** it renders from the declared schema and status, with no extension-supplied code

### Requirement: Transport-derived actor and permissions
The acting actor and permission set for every extension and environment operation SHALL be
derived from the authenticated transport, never from operation payload fields.

#### Scenario: Payload-claimed actor is ignored
- **WHEN** a request carries an actor or permission claim in its payload
- **THEN** the server authorizes it using the transport-derived identity instead

### Requirement: Same secret-broker contract in both runtime modes
Embedded and standalone headless servers SHALL compose and unlock the secret vault such that
an extension's scoped secret resolution behaves identically in both modes.

#### Scenario: Same fixture extension in both modes
- **WHEN** the same fixture extension registers a provider in an embedded server and in a
  standalone server
- **THEN** its scoped secret resolution and provider registration behave identically
