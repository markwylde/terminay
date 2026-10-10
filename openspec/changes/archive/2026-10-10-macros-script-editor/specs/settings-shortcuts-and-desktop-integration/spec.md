## ADDED Requirements

### Requirement: Server-authoritative file and macro definitions

File-panel diff-layout changes SHALL use the same settings command facade and SHALL remain server-authoritative across the shared UI hosts. File-extension defaults saved in Settings SHALL be observed by already-mounted Desktop and browser workspaces through that same selected-server client, and the file panel SHALL NOT consult a separate browser-local settings snapshot. Macro definitions and categories SHALL require an explicitly supplied selected-server client; there SHALL be no ambient macro compatibility context or preload-shaped fallback. The macro settings client SHALL expose macro definitions and categories only, and no host SHALL offer it a secret action.

#### Scenario: File-extension default changed

- **WHEN** a file-extension default is saved in Settings
- **THEN** already-mounted Desktop and browser workspaces observe it through the selected-server client

#### Scenario: Macro settings client surface

- **WHEN** the Macros window is given its selected-server client on any host
- **THEN** the client reads, replaces, resets, and observes macro definitions and categories, and exposes no operation that reads, saves, or deletes a secret

## REMOVED Requirements

### Requirement: Server-authoritative file and macro settings

**Reason**: Half of this requirement described secret actions on the macro settings client and a host secret capability. Macros carry no secrets, so that half is gone; the file and macro-definition half continues unchanged under a name that no longer implies it.

**Migration**: See "Server-authoritative file and macro definitions". Code that called a secret method on the macro settings client has no replacement.
