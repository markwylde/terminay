## ADDED Requirements

### Requirement: The service environment names the renderer directory the server reads

`daemon install` SHALL write the workspace UI location under the variable the server reads to build its hosted UI archive, in addition to the variable the server reads to serve its local HTTP UI. They are two settings that happen to share a value; writing only one leaves a server that pairs successfully and then serves no workspace.

An installed server SHALL therefore hand a paired device the workspace UI shipped in its own archive, without an operator editing the environment file.

#### Scenario: Install writes both UI variables

- **WHEN** `daemon install` completes
- **THEN** the service environment names the archive's UI directory as the renderer directory
- **AND** it also names it as the local UI bundle

#### Scenario: A paired device receives a workspace

- **WHEN** a device pairs with a server installed by the CLI
- **THEN** it receives the workspace UI from that server's archive, not a placeholder

#### Scenario: Upgrading an install made before this

- **WHEN** `daemon upgrade` runs against a server whose environment names only the local UI bundle
- **THEN** the renderer directory is added, so the upgraded server serves a workspace
