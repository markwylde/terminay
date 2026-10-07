## MODIFIED Requirements

### Requirement: Terminal authorization identity

The server terminal boundary SHALL use immutable `{serverId, projectId, sessionId}` identity. Input SHALL be accepted only for that exact live session and SHALL be bounded by the negotiated input-byte limit; resize and termination SHALL use the same authorization boundary.

A terminal SHALL change project only when the server commits a `panel.move` of its panel. That commit SHALL retire the terminal's identity under the source project and bind an identity under the target project for the same PTY, with the same session id, scrollback, and output position. An identity SHALL never be edited in place: every attachment, presentation lease, checkpoint pin, queued input, resize ownership, and capability bound to the retired identity SHALL end with it, and a request that names the retired identity SHALL be rejected. The terminal SHALL be listed, observed for close protection, and reported in activity and agent status under the target project only.

#### Scenario: Input for another session

- **WHEN** input, resize, or termination is addressed to a session other than the exact live authorized one
- **THEN** it is rejected

#### Scenario: Terminal moved to another project

- **WHEN** the server commits a move of a live terminal's panel to another project
- **THEN** the same PTY continues under an identity in the target project, with its session id, scrollback, and output position unchanged

#### Scenario: Request under the retired identity

- **WHEN** input, resize, attach, or termination names a moved terminal's source project
- **THEN** it is rejected, and nothing bound to the retired identity remains usable

#### Scenario: Client attached during a move

- **WHEN** a client is attached to a terminal as its panel is moved to another project
- **THEN** that attachment ends, and the client attaches under the target project identity and continues from the terminal's retained output

#### Scenario: Project listings after a move

- **WHEN** terminals are listed or observed for the source project and for the target project after a move
- **THEN** the moved terminal appears under the target project and not under the source project
