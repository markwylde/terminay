## ADDED Requirements

### Requirement: Bounded extension protocol operations

Fixed `extensions.*` operations SHALL expose bounded management, status, and declarative-form DTOs. Extensions SHALL NOT register arbitrary public application operations. Every project operation SHALL derive its project identity from canonical server state before dispatch.

#### Scenario: Extension attempting to expose an operation

- **WHEN** an extension attempts to register a public application operation
- **THEN** the request is refused and only the fixed bounded operations are exposed

#### Scenario: Dispatching a project operation

- **WHEN** a project operation is dispatched
- **THEN** its project identity is derived from canonical server state rather than from client-supplied values

### Requirement: Runtime roles and execution ownership

Terminay SHALL have four distinct runtime roles: Terminay Server owning workspace, trust, extension, and privileged-service authority; Terminay Desktop owning native windows, local-server supervision, OS integration, connection credentials, verified bundle installation, and opaque transport delivery; the PWA connection manager owning browser-local stable-origin bookmarks and navigation; and the hosted session and signaling service owning origin-isolated session bootstrap, WebRTC signaling, and operational relay state. The hosted service SHALL never become a terminal, filesystem, or application-data proxy.

#### Scenario: Executing a project

- **WHEN** a project is executed
- **THEN** it runs on the host of the Terminay Server that owns it

#### Scenario: Hosted service handling traffic

- **WHEN** a remote client connects through hosted signaling
- **THEN** no terminal, filesystem, or application data becomes hosted application data

## MODIFIED Requirements

### Requirement: Server data root

Workspace state, settings, macros, registered device public keys, audit events, extension packages, receipts and data, and service metadata SHALL live under one documented server data root. Workspace and project files and configured recording directories SHALL remain at their user-selected filesystem locations.

#### Scenario: Locating canonical state

- **WHEN** an operator inspects a server installation
- **THEN** all canonical server-owned state is found under the documented data root

#### Scenario: User-selected locations

- **WHEN** a project root or recording directory is configured
- **THEN** its files remain at the user-selected filesystem location rather than moving into the data root

### Requirement: Extension runtime hosting

The server SHALL include the pinned npm installer needed by the extension platform while standalone support continues to require no system Node, npm, compiler, or browser. Official pinned extension tarballs SHALL be release inputs. Installed packages SHALL live under the writable server data root and SHALL NOT mutate the signed or content-addressed UI and application bundle. Each enabled extension SHALL run in a supervised server child process with bounded private IPC, and extension failure SHALL be provider-scoped and SHALL NOT prevent core or server readiness. Custom extensions remain trusted server-account code; process separation SHALL NOT be described as hostile-code sandboxing.

#### Scenario: Installing an extension

- **WHEN** an extension package is installed
- **THEN** it is written under the writable server data root and the signed bundle is unchanged

#### Scenario: Extension crash

- **WHEN** an enabled extension's child process fails
- **THEN** the failure is provider-scoped and core and server readiness are unaffected

### Requirement: Data-root-scoped server authority identity

Every implicit embedded or standalone server SHALL derive a durable identity scoped to its own data root, so two `terminay-server` processes with separate data roots and endpoints never default to one shared identity. That resolved identity SHALL thread the server's terminal, workspace, recording, local UI, profile, cache, and exposure composition, and SHALL remain stable across restarts. An explicit `--server-id` SHALL remain an intentional operator choice and SHALL be rejected when its endpoint or data-root ownership is inconsistent. An identity record belonging to another data root SHALL fail closed rather than being adopted.

#### Scenario: Two implicit servers

- **WHEN** two servers start with separate data roots and endpoints and no explicit identity
- **THEN** each receives a distinct durable identity, profile, partition, and store

#### Scenario: Restart

- **WHEN** a server restarts against the same data root
- **THEN** it resolves the same durable identity

#### Scenario: Inconsistent explicit identity

- **WHEN** an explicit `--server-id` is inconsistent with the endpoint or data-root ownership
- **THEN** startup is rejected

#### Scenario: Foreign identity record

- **WHEN** an identity record belonging to another data root is found
- **THEN** it fails closed and is not adopted

## REMOVED Requirements

### Requirement: Bounded extension and environment protocol operations

**Reason:** The `project-environments.*` operations are removed with the project environment layer. Replaced by "Bounded extension protocol operations".

**Migration:** None; there are no installed users.

### Requirement: Environment routing authority

**Reason:** Project environments are removed; file, Git, terminal, shell-discovery, observation, and MCP operations execute directly against the server host, so there is no router to hold authority.

**Migration:** None; there are no installed users. Reaching another machine means running a Terminay Server on it and connecting to it.

### Requirement: Runtime roles

**Reason:** Terminay Server no longer owns project-environment routing, and the server host is not one execution machine among several. Replaced by "Runtime roles and execution ownership".

**Migration:** None; there are no installed users.
