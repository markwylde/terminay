## ADDED Requirements

### Requirement: MDX runtime protocol operations

The runtime SHALL expose exactly three application-protocol operations. `mdx.compile` SHALL be a binary query taking a project identity, a project-relative entry path, and an optional known revision, whose metadata identifies the runtime revision, entry module, bounded diagnostics, imported project resources, and completeness, and whose body carries compiled browser JavaScript. `mdx.resource` SHALL be a binary query taking a project identity, runtime revision, opaque resource id, offset, and length, returning a bounded content range with its MIME type and total length, and SHALL NOT accept a raw path from preview JavaScript. `mdx.dispose` SHALL be a command releasing compilation and resource state for one runtime id owned by the calling client. Source text and compiled bundles SHALL NOT be carried in an unbounded JSON envelope.

#### Scenario: Compiling an entry document

- **WHEN** a client issues a compile query for a project-relative entry path
- **THEN** it receives metadata naming the runtime revision, entry module, bounded diagnostics, imported project resources, and completeness
- **AND** the body carries compiled browser JavaScript

#### Scenario: Requesting a project resource

- **WHEN** a client requests a resource range by opaque resource id, offset, and length
- **THEN** it receives a bounded content range with its MIME type and total length

#### Scenario: Raw path in a resource request

- **WHEN** preview JavaScript attempts to request a resource by filesystem path rather than opaque resource id
- **THEN** the request is rejected

#### Scenario: Disposing a runtime

- **WHEN** a client disposes a runtime id it owns
- **THEN** that runtime's compilation and resource state is released

### Requirement: Authenticated project scope for runtime operations

Every runtime operation SHALL derive its project scope from the authenticated dispatcher context. A project identity carried in a request payload SHALL grant no authority on its own, and a request whose client, project, or runtime id does not match the authenticated scope SHALL be rejected.

#### Scenario: Payload project identity alone

- **WHEN** a request carries a project identity in its payload that the authenticated dispatcher context does not grant
- **THEN** the request is rejected and no compilation or resource data is returned

#### Scenario: Mismatched runtime id

- **WHEN** a client references a runtime id owned by another client or project
- **THEN** the request is rejected

### Requirement: Preview origin prerequisite

A preview document SHALL NOT combine script execution with same-origin access to Terminay's application origin. Where persistent cookies and storage require same-origin access, the preview SHALL be served from a dedicated preview origin that is cross-origin to Terminay and scoped to the canonical project, and that origin SHALL be established before same-origin access is enabled. A host that cannot provide such an origin SHALL report the preview capability as unavailable rather than weakening isolation.

#### Scenario: Host cannot provide a preview origin

- **WHEN** the host cannot serve a dedicated cross-origin preview origin
- **THEN** the preview capability is reported unavailable
- **AND** script execution is not granted same-origin access to Terminay's application origin

#### Scenario: Preview origin established first

- **WHEN** persistent cookies and storage require same-origin access
- **THEN** the dedicated project-scoped preview origin is established before same-origin access is enabled

### Requirement: Host-neutral preview implementations

Preview hosting SHALL be one host-neutral interface with a Desktop and a web implementation, and both SHALL satisfy the same capability expectations for execution, networking, external assets, storage isolation, JavaScript form submission, blocked navigation, blocked popups, and absence of Electron, preload, and parent authority. The preview component SHALL accept only compiled bytes and resource callbacks and SHALL NOT accept a filesystem path.

#### Scenario: Same expectations on both hosts

- **WHEN** the same preview is exercised on the Desktop and web implementations
- **THEN** both satisfy the same execution, networking, asset, storage-isolation, form, navigation, popup, and withheld-authority expectations

#### Scenario: Path offered to the preview component

- **WHEN** a caller attempts to give the preview component a filesystem path instead of compiled bytes and resource callbacks
- **THEN** the interface does not accept it
