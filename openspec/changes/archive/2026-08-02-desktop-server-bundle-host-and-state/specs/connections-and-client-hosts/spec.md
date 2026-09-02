## MODIFIED Requirements

### Requirement: Desktop launches the selected server's bundle

Desktop SHALL launch the exact verified workspace bundle owned by the selected server for every Local and remote connection window. Local SHALL obtain the bytes from its pinned embedded-server artifact; remote SHALL obtain them through the authenticated server asset channel. Desktop SHALL never run its independently packaged Local workspace renderer against a different remote server.

#### Scenario: Remote window runs the remote server's bundle

- **WHEN** a Desktop window binds to a remote profile
- **THEN** it launches that server's verified bundle obtained through the authenticated asset channel

#### Scenario: Same bundle id across hosts

- **WHEN** Local Desktop, remote Desktop, and browser sessions are launched against one server
- **THEN** they report the same verified bundle id and differ only in transport and declared host capabilities

### Requirement: Verified bundle cache

Desktop SHALL commit a native window only after the bundle inventory has been verified, its host compatibility requirements accepted, and an exact profile, server, and bundle binding reserved. Local SHALL read the pinned bundle directly from the embedded artifact and SHALL NOT download it through a public listener. Remote SHALL read through its authenticated asset lane into an atomic, content-addressed cache rooted beneath a digest of the exact server identity. An interrupted or invalid replacement SHALL retain the last complete verified bundle for that server. Every cache entry SHALL remain bound to its exact server identity.

#### Scenario: Interrupted download keeps the last good bundle

- **WHEN** a bundle replacement is interrupted or invalid
- **THEN** the last complete verified bundle for that server is retained

#### Scenario: Cache is partitioned by server identity

- **WHEN** two servers publish bundles
- **THEN** each cache entry stays rooted beneath a digest of its exact server identity

### Requirement: Remote code containment in Electron

Remote server-provided code inside Electron SHALL run with sandboxing, context isolation, Node integration disabled, and no ambient privileged preload. A minimal host bridge SHALL validate every native action. The Desktop shell SHALL resolve the selected server bundle manifest and assets only on that profile's exact session origin. Same-origin bundle navigation SHALL be allowed; arbitrary origins, URL credentials or query state, new windows, downloads, permission prompts, and custom protocol handlers SHALL be denied by default. A privileged host MAY explicitly allow one guarded request through the native policy boundary.

#### Scenario: Off-origin navigation is denied

- **WHEN** a bundle attempts to navigate to an arbitrary origin
- **THEN** the navigation is denied

#### Scenario: Downloads and permission prompts are denied by default

- **WHEN** a remote bundle triggers a download, new window, permission prompt, or custom protocol handler
- **THEN** it is denied unless a privileged host explicitly allows that one guarded request

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be a closed allowlist of sanitized profiles, protected credential references, native geometry and exact profile and view bindings, verified bundle-cache metadata, update state, OS permission decisions, and explicit device preferences. Workspace snapshots, application DTOs, project roots, panel and terminal state, server settings, and feature capability projections SHALL be forbidden in the host store. Unclassified fields SHALL fail closed.

#### Scenario: Unclassified field is rejected

- **WHEN** a field outside the allowlist is written to the Desktop host store
- **THEN** the write fails closed

#### Scenario: Workspace state stays server-owned

- **WHEN** Desktop persists host state
- **THEN** no workspace snapshot, application DTO, project root, panel or terminal state, server setting, or capability projection is stored

### Requirement: Native window server binding

A native window SHALL be bound to exactly one server at a time, and its title and security scope SHALL make the connection clear. Multiple windows MAY target the same server and different logical workspace views, and other windows MAY simultaneously target other servers. Selecting a profile SHALL focus an existing window for that connection or view when appropriate, or open a new sandboxed window; rebinding the current window SHALL be an explicit action rather than a side effect of menu selection. Native window identity and server logical-view identity SHALL remain separate bindings, so focus or close does not mutate a logical view without a typed server command.

#### Scenario: Four windows across four servers

- **WHEN** four Electron windows show one Local and three remote servers
- **THEN** no server, project, or credential state crosses between them

#### Scenario: Menu selection does not rebind silently

- **WHEN** the user selects another profile from the connection menu
- **THEN** an existing window is focused or a new sandboxed window opens, and the current window is not rebound
