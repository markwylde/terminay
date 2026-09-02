## MODIFIED Requirements

### Requirement: Live stream integrity after hydration

Live terminal output SHALL share the binary application lane with command results and later workspace events. Attach snapshots, later PTY bytes, new projects, and new terminals SHALL be the same live stream. A generation that hydrates a checkpoint but cannot decode or deliver later events SHALL be failed rather than connected. A new project or terminal created after hydrate SHALL appear on the remote view only while that generation can still deliver. Data-channel frames SHALL be `ArrayBuffer` bytes before the workspace reads them; a `Blob` SHALL be decoded in order or fail that generation visibly, and SHALL never be dropped.

#### Scenario: Hydrated-but-dead generation is failed

- **WHEN** a generation paints a terminal checkpoint but cannot stream later PTY or workspace events
- **THEN** it is treated as a recoverable transport failure and is not left mounted as connected
- **AND** connection and terminal chrome show reconnecting until the replacement generation hydrates

#### Scenario: Post-hydrate creation appears live

- **WHEN** a new project or terminal is created after hydrate on a live generation
- **THEN** it appears on the remote view

#### Scenario: Blob frames are decoded in order

- **WHEN** a data-channel frame arrives as a `Blob`
- **THEN** it is decoded in order or fails that generation visibly, and is never dropped

#### Scenario: Repeated reconnect cycles recover

- **WHEN** at least three reconnect cycles occur in a row during continuous PTY output
- **THEN** each hydrates a checkpoint and then streams new output within the heartbeat bound
