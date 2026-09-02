## MODIFIED Requirements

### Requirement: Settings classification by authority

Server-owned workspace state SHALL classify settings by authority: server settings for shells, workspace behaviour, files and Git, recordings, agents, AI, macros, secrets, and exposure; connection-host settings for remembered server metadata, native window geometry, and inherently device-specific behaviour; and transient client state that is not persisted as product configuration.

#### Scenario: Classifying a setting

- **WHEN** a setting is persisted
- **THEN** it is stored in its declared server, connection-host, or transient scope

### Requirement: Desktop host ownership

Terminay Desktop SHALL own native menus, windows, updater, clipboard, dialogs, and OS credential storage. Shared settings, recordings, and edit components SHALL be able to render as native auxiliary windows on Desktop or in-page routes on web.

#### Scenario: Shared component presentation

- **WHEN** a shared settings, recordings, or edit component renders
- **THEN** it appears as a native auxiliary window on Desktop or an in-page route on web

### Requirement: Server settings client boundary

The shared terminal-settings hook SHALL read and observe server settings through the transport-neutral `SettingsClient` bundled with the selected server UI. The host bridge SHALL NOT answer or translate server settings operations. Shared components SHALL NOT subscribe to preload events directly. No terminal-settings preload global or snapshot adapter SHALL exist, and missing selected-server settings authority SHALL be reported as unavailable rather than falling back to device-local settings.

#### Scenario: Reading server settings

- **WHEN** a shared component reads or observes server settings
- **THEN** it uses the `SettingsClient` bundled with the selected server UI

#### Scenario: Settings authority missing

- **WHEN** the selected server's settings authority is unavailable
- **THEN** the condition is reported as unavailable and no device-local fallback is used

### Requirement: Secret storage and vault disclosure

API keys and other secrets SHALL use the appropriate server or client vault and SHALL NOT be returned as plaintext after being saved. Settings that enable integrations SHALL describe their data exposure and SHALL remain opt-in where they capture or transmit content. The server vault SHALL report only lock and availability state, revision, and secret metadata — identifier, label, configured state, and version. Set, replace, test, delete, and key-rotation operations SHALL run inside the server vault. A secret SHALL be available to server code only through a scoped callback and SHALL NOT be part of a settings snapshot, protocol response, or diagnostic record.

#### Scenario: Reading a saved secret

- **WHEN** a client reads vault state after a secret is saved
- **THEN** it receives only lock and availability state, revision, and secret metadata, never plaintext

#### Scenario: Integration disclosure

- **WHEN** a setting enables an integration that captures or transmits content
- **THEN** it describes its data exposure and remains opt-in

### Requirement: Vault operation boundaries

Vault set, replace, test, delete, and rotation operations SHALL be revisioned and SHALL expose only metadata. `restartLock` SHALL be an explicit host lifecycle boundary. Adapter and decryption failures SHALL be converted to bounded operation codes without forwarding paths, provider messages, or plaintext.

#### Scenario: Vault operation performed

- **WHEN** a set, replace, test, delete, or rotation operation runs
- **THEN** it is revisioned and returns only metadata

#### Scenario: Adapter or decryption failure

- **WHEN** a vault adapter or decryption failure occurs
- **THEN** it is converted to a bounded operation code without forwarding paths, provider messages, or plaintext
