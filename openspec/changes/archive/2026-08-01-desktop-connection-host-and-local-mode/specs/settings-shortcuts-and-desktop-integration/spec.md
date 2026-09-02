## ADDED Requirements

### Requirement: Desktop host ownership
The Desktop host SHALL retain sole ownership of the updater, application menus, application
lifecycle, operating-system integration, local credential storage, and embedded server
supervision. Application services SHALL NOT be reintroduced into the host, and an import
boundary SHALL enforce this.

#### Scenario: Import boundary
- **WHEN** host code imports an application service, or renderer code imports Electron, IPC, or Desktop main/preload modules
- **THEN** the import boundary check fails

#### Scenario: Native actions require validated capabilities
- **WHEN** a native menu, clipboard, reveal, external-link, dialog, or window action is requested
- **THEN** it is performed only through a documented validated capability bridge

### Requirement: Application menu presentation
Native menu command dispatch from the server bundle SHALL be restricted to the exact command
ids advertised by the current host presentation, and SHALL require both the native-windows and
OS-integration host capabilities. The native shell, not the server bundle, SHALL be the
authority for the available command set.

#### Scenario: Unadvertised command
- **WHEN** the server bundle requests a menu command id the current host presentation does not advertise
- **THEN** the request is denied

#### Scenario: Capability withdrawn
- **WHEN** either the native-windows or OS-integration capability is unavailable
- **THEN** native menu dispatch is denied regardless of what the presentation advertises

### Requirement: macOS smart paste in the terminal
Terminal copy and paste SHALL use only the versioned clipboard host capability. The host SHALL
validate the trusted top-level sender, the exact envelope shape and version, and a bounded text
size before touching the operating-system clipboard.

#### Scenario: Bounded clipboard write
- **WHEN** the workspace writes text to the clipboard through the versioned capability
- **THEN** the host validates sender, envelope, version, and text bound before writing

#### Scenario: No broad clipboard route
- **WHEN** the renderer attempts a broad ambient clipboard call
- **THEN** neither the preload method nor the underlying channel exists

### Requirement: Update availability checks
Native update status SHALL be read only through the versioned update host capability, which
validates the trusted sender and an exact versioned request envelope before consulting the
native update cache. Update links SHALL open through the versioned external-link capability,
which applies the existing credential-free HTTPS shell policy.

#### Scenario: Update status request
- **WHEN** the workspace requests update status
- **THEN** the host validates the trusted sender and exact envelope before returning its bounded native update state

#### Scenario: Update link
- **WHEN** the workspace opens the update link
- **THEN** it uses the versioned external-link capability and the host applies its credential-free HTTPS policy
