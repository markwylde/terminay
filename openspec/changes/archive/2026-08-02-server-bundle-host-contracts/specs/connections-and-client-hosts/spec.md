## ADDED Requirements

### Requirement: Versioned source-bound host bridge

A host SHALL expose exactly one runtime-validated bootstrap carrying the exact server and profile identity, the verified bundle identity, the opaque byte-endpoint version, the host-bridge version, the host kind, and the individually declared capabilities. Host privilege SHALL NOT be renderer-selected: a `mode=electron` marker, a URL or query privilege flag, a server-supplied capability, or an unknown bootstrap field SHALL be rejected. Each native action that reads or changes host state SHALL require exact source, window, profile, and server binding and a user gesture.

#### Scenario: Renderer cannot elect a privileged mode

- **WHEN** a renderer supplies `mode=electron`, a URL or query privilege flag, or a server-supplied capability
- **THEN** the bootstrap is rejected and no privileged host mode is granted

#### Scenario: Unknown bootstrap field fails closed

- **WHEN** the bootstrap carries an unknown field
- **THEN** validation fails and the host does not start the bundle

#### Scenario: Native action requires binding and gesture

- **WHEN** a native action that reads or changes host state is requested
- **THEN** it proceeds only with exact source, window, profile, and server binding and a user gesture

### Requirement: Bounded host bridge surface

The host bridge SHALL expose a closed registry of versioned semantic actions, limited to route and window presentation, native menus, approved file selection, clipboard write, notifications, the updater, and guarded operating-system integration. The registry SHALL NOT expose a raw `BrowserWindow`, arbitrary filesystem paths, generic IPC, or server commands. Capabilities SHALL be declared individually so that each degrades independently, and SHALL NOT be enabled by renderer or server input.

#### Scenario: Generic IPC is refused

- **WHEN** a renderer requests generic IPC, a raw window handle, or an arbitrary path through the bridge
- **THEN** the request is refused

#### Scenario: Capabilities degrade independently

- **WHEN** one declared capability is absent
- **THEN** the remaining capabilities continue to work and the absent one reports a clear unavailable action
