## ADDED Requirements

### Requirement: Agent provider registration and terminal-incarnation admission

An extension SHALL register an agent provider at activation through `context.agents.registerProvider(definition, runtime)`, which SHALL return a disposable registration. Registration SHALL fail closed for a provider id the manifest did not contribute, a duplicate provider id, or a registration attempted after deactivation. Each provider contribution SHALL declare a namespaced provider id, display metadata, supported platforms, executable and process matchers, provider version and mapping declarations, and the environment-observation capabilities it requires. The host SHALL issue a terminal context bound to the exact server, project, terminal session, and process incarnation, and SHALL reject publications, acknowledgements, cancellations, and observation requests that name a stale context, another terminal, or an undeclared provider. Oversized or malformed host messages SHALL be rejected without reaching the canonical store.

#### Scenario: Undeclared provider id

- **WHEN** an extension registers a provider id its manifest did not contribute
- **THEN** the registration is refused

#### Scenario: Duplicate registration

- **WHEN** an extension registers the same provider id twice, or registers after deactivation
- **THEN** the registration is refused

#### Scenario: Cross-terminal handle

- **WHEN** an extension uses a handle issued for another terminal or a retired context
- **THEN** the operation is rejected and nothing is written to the canonical store

#### Scenario: Oversized message

- **WHEN** an oversized or malformed message arrives on the extension host channel
- **THEN** it is rejected before it reaches the canonical store

### Requirement: Exact-once observer retirement

Terminal exit, provider disable, provider update, project removal, project-environment revision change, extension child crash, and server shutdown SHALL each retire the affected observation contexts exactly once, and a repeated cause SHALL NOT retire them again. Retirement SHALL cancel the extension's observers and SHALL permit a fresh admission afterwards. A stalled or crashed retirement for one provider SHALL leave unrelated providers' contexts usable, and per-extension process isolation with restart and backoff SHALL be preserved.

#### Scenario: Repeated retirement cause

- **WHEN** the same retirement cause is applied twice to one context
- **THEN** the context is retired exactly once

#### Scenario: Retirement then re-admission

- **WHEN** a context is retired and the terminal matches a provider again
- **THEN** a fresh admission is accepted

#### Scenario: Crashing extension

- **WHEN** one extension's child crashes or stalls during retirement
- **THEN** unrelated providers' contexts remain usable and the crashed extension restarts under the ordinary backoff

### Requirement: Target-owned vault references in provider-dependency calls

A provider-dependency call SHALL authenticate both the calling and target extension, SHALL require the caller's declared extension dependency and the target's declared operation, and SHALL forward bounded deadlines, cancellation, idempotency keys, and the environment revision. Secret material created for a dependency SHALL be owned by the target extension: the target SHALL hold it in the Terminay Server vault under its own scope and SHALL return only an opaque reference scoped to that extension installation and provider. A dependency reference SHALL NOT expose secret bytes to the caller. Vault writes SHALL be revisioned and SHALL atomically replace the durable binding, transient copies handed to a bounded callback SHALL be zeroized when it completes, and pending removal SHALL block new uses while allowing active work to finish.

#### Scenario: Managed binding returns no secret bytes

- **WHEN** a dependent extension asks its declared target to create or use a managed credential
- **THEN** it receives an opaque scoped reference and never the secret bytes or a vault id it can enumerate

#### Scenario: Undeclared dependency call

- **WHEN** an extension calls a target it did not declare, or an operation the target did not declare
- **THEN** the call fails closed

#### Scenario: Pending removal

- **WHEN** a managed binding is pending removal
- **THEN** new uses are refused while the active bounded callback completes, after which cleanup finishes

### Requirement: Terminal-scoped directory list and watch operations

The public observation broker SHALL offer terminal-scoped directory listing and directory watching for the exact terminal's environment, with bounded results, cancellation, and atomic-replacement handling. These operations SHALL be available only through the broker, SHALL be routed through the terminal's project environment, and SHALL NOT read a directory outside the broker-issued scope.

#### Scenario: Bounded directory watch

- **WHEN** an extension watches a directory through the broker
- **THEN** results are bounded, replacement is handled, and cancellation disposes the watcher

#### Scenario: Out-of-scope directory

- **WHEN** an extension lists or watches a directory outside its broker-issued terminal scope
- **THEN** the request is refused

### Requirement: Public observation adapters and driver toolkit

The public SDK SHALL define an observation-adapter interface and a driver toolkit that an extension MAY use to implement a provider: bounded JSONL replay and follow, incomplete-line buffering, truncation and atomic-replacement detection including inode or device replacement, over-limit discard, cancellation helpers, versioned mapping selection, safe string handling, and canonical event builders with validation. The toolkit SHALL accept public adapters and plain data so an extension MAY back it with Node APIs for **This server** or with the environment-routed broker for a remote environment, and a provider MAY implement another bounded format without using the toolkit. Diagnostics produced through the toolkit SHALL be typed and safe to display, carrying no paths, prompts, credentials, native payloads, or arbitrary provider errors.

#### Scenario: Split record across chunks

- **WHEN** a JSONL record or UTF-8 sequence is split across follow chunks
- **THEN** the toolkit buffers it until complete rather than emitting a partial record

#### Scenario: Truncation or replacement

- **WHEN** the observed file is truncated or atomically replaced
- **THEN** the toolkit reports the reset and re-establishes reading

#### Scenario: Unavailable provider diagnostic

- **WHEN** a provider becomes unavailable
- **THEN** a typed diagnostic is produced with no path, prompt, credential, native payload, or raw provider error

### Requirement: Public agent-extension harness and third-party author example

The public SDK SHALL ship an in-memory agent-extension test harness and a documented author example. The repository SHALL contain a minimal third-party agent extension package that is not derived from an official provider and that builds, packs, activates, and passes conformance using only the public SDK. Generated API reference material SHALL document every bound, cancellation rule, ordering guarantee, rebind rule, error class, and lifecycle example needed to build, test, package, and diagnose an agent extension without reading Terminay source.

#### Scenario: Third-party fixture extension

- **WHEN** the independent third-party agent fixture is packed and activated
- **THEN** it registers a provider, observes a fixture session, and publishes canonical lifecycle events using only the public SDK

#### Scenario: Author documentation completeness

- **WHEN** an author consults the generated API reference
- **THEN** it documents the bounds, cancellation rules, ordering and rebind guarantees, error classes, and lifecycle examples for an agent extension
