## ADDED Requirements

### Requirement: A terminal panel move and its session re-home commit together

When a `panel.move` of a terminal panel commits, the server SHALL bind the terminal's identity under the target project before it publishes the new workspace revision, so no client observes a revision in which the panel's project and the terminal's project differ. The published change SHALL name the moved session along with the panel and both projects. A `panel.move` that cannot be committed SHALL leave the panel, the session record, and the terminal's identity unchanged. The same rule SHALL hold whether the command arrives from a client or from the host.

#### Scenario: Revision published after a terminal move

- **WHEN** a client receives the workspace revision that moved a terminal panel
- **THEN** the terminal already accepts an attach under the target project and rejects one under the source project

#### Scenario: Move that cannot be committed

- **WHEN** a `panel.move` is rejected by validation, policy, or a revision conflict
- **THEN** the panel, its session record, and the terminal's identity are all unchanged

#### Scenario: Host-issued move

- **WHEN** the host applies a `panel.move` for a terminal panel
- **THEN** the terminal is re-homed exactly as for a client-issued move

### Requirement: A client relocates a terminal whose canonical project changed

A client that presents a terminal panel in a project other than the one the newest confirmed projection places it in SHALL relocate that presentation to the canonical project, and SHALL NOT present the terminal in both. Relocation SHALL NOT close the canonical panel or end its session, and SHALL keep the panel's device-local presentation state. A terminal relocated because another client moved it SHALL NOT take focus or change the active project.

#### Scenario: Another client moves a terminal

- **WHEN** another client of the same server moves a terminal to a different project
- **THEN** this client presents the terminal in that project only, without a reload, and its active project and focused terminal are unchanged

#### Scenario: Relocation keeps the session

- **WHEN** a client relocates a terminal's presentation to its canonical project
- **THEN** no `panel.close` is sent and the terminal session stays live
