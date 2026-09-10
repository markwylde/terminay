## MODIFIED Requirements

### Requirement: Semantic secondary-route presentation

The server-bundled UI SHALL request semantic secondary-route presentation. When its negotiated `nativeWindows` capability is present, Desktop SHALL open dedicated native windows for settings — including its Extensions section — macros, and recordings, and SHALL use modal editing only for tab and project editing. Browser hosts and compatible Desktop shells without that capability SHALL present the same routes in-page with route or editing semantics appropriate to the viewport.

#### Scenario: Desktop with native windows

- **WHEN** the Desktop host negotiates the `nativeWindows` capability
- **THEN** settings, macros, and recordings open as dedicated native windows and only tab and project editing use modals

#### Scenario: Host without native windows

- **WHEN** a browser host or a Desktop shell without that capability requests the same routes
- **THEN** they are presented in-page with route or editing semantics appropriate to the viewport

### Requirement: Management surface commands

File and the Command Bar SHALL expose **Create a new terminal tab**, **Create a new project**, and then the management surfaces **Remote Control**, **Extensions…**, **Macros**, **Recordings**, and **Settings** through the same semantic route and command model. **Remote Control** SHALL open or focus the connection-management window on Desktop, and **Extensions…** SHALL open or focus the established Settings window at the Extensions section. Web SHALL use the corresponding in-page routes. These surfaces SHALL manage the selected Terminay Server or host connection list, not project or tab editor sheet chrome.

#### Scenario: Opening Remote Control on Desktop

- **WHEN** a user invokes **Remote Control** on Desktop
- **THEN** the connection-management window opens or is focused

#### Scenario: Opening Extensions

- **WHEN** a user invokes **Extensions…**
- **THEN** the established Settings window opens or is focused at the Extensions section

#### Scenario: Web management routes

- **WHEN** a user invokes any management surface on the web host
- **THEN** the corresponding in-page route opens

### Requirement: Extensions presentation in Settings

Extensions SHALL appear within the ordinary Settings navigation, and all extension commands SHALL focus that section rather than creating an Extensions-only modal. Remote Control SHALL open as a reusable management window consistent with Settings, Macros, and Recordings on Desktop, and as the equivalent shared in-page route on web.

#### Scenario: Extension command invoked

- **WHEN** any extension command is invoked
- **THEN** the Settings window focuses its Extensions section and no Extensions-only modal is created

#### Scenario: Management window reuse

- **WHEN** Remote Control is invoked repeatedly on Desktop
- **THEN** the same reusable management window is focused, consistent with Settings, Macros, and Recordings
