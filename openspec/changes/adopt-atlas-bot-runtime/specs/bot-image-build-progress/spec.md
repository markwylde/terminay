## ADDED Requirements

### Requirement: Image build status uses a compact actionable banner

The Bots surface SHALL summarize builds in one clickable line with current activity, server identity where needed and a details affordance. It SHALL contain no embedded logs or multi-row build card. Long text SHALL truncate accessibly without wrapping or overflow. Keyboard/pointer activation SHALL open the matching build-progress page without starting a build. Failures SHALL link to details; image controls SHALL retain access to the latest completed build.

#### Scenario: Build underway

- **WHEN** the shared bot image is building
- **THEN** the Bots surface shows one compact status row and activating it opens the matching progress page

#### Scenario: Narrow viewport

- **WHEN** a long active step is shown on a narrow screen
- **THEN** the banner stays on one line without horizontal page overflow and the full description remains accessible

### Requirement: Build details show an accessible step timeline

The build page SHALL show server/build identity, overall state, elapsed duration and an ordered vertical step timeline. Each row SHALL have a left status marker: green tick/completed, amber activity/running, red cross/failed or neutral/pending. Text/icons SHALL communicate status without colour alone. Cached rows SHALL be labelled cached, and parallel active steps SHALL remain visible. Step descriptions SHALL explain the work; commands/logs SHALL be expandable secondary detail.

#### Scenario: Step completes

- **WHEN** the engine reports a step completed and another started
- **THEN** the completed row shows a green tick and the active row shows an amber indicator with its description

#### Scenario: Step fails

- **WHEN** an application installation fails
- **THEN** its row shows a red cross, an explanatory failure summary and expandable output, and the overall build is failed

#### Scenario: Cached or parallel work

- **WHEN** the build reports cached steps or multiple concurrent vertices
- **THEN** the timeline labels cached work and shows every active step without inventing completion or percentages

### Requirement: Progress reflects authoritative engine events

Server progress SHALL derive from actual Docker/Podman build events with stable build/step ids, bounded validated snapshots/logs and bot authority. Parsing SHALL handle fragmented records and both engines' formats. Unknown output SHALL remain readable without invented completion or percentages. Success SHALL require local-tag publication. Existing event invalidations SHALL drive updates without polling. Retries SHALL have distinct ids; concurrent requests SHALL attach to the active build.

#### Scenario: Publication fails after Dockerfile steps

- **WHEN** all Dockerfile steps finish but publishing the local image tag fails
- **THEN** the overall timeline reports failure at publication rather than reporting a ready image

#### Scenario: Fragmented engine output

- **WHEN** an engine output record arrives across multiple chunks
- **THEN** it produces the same step transition as a complete record and malformed output does not break the progress page

### Requirement: Build details survive navigation and connection loss

The server SHALL own progress independently of viewers. Navigation/reconnect SHALL recover the same active/latest snapshot and bounded redacted logs. Disconnection SHALL show reconnecting/unavailable, never false success. Restart SHALL retain summaries and mark unconfirmed builds interrupted without replay. Back SHALL restore the prior Bots view without stopping work. Failure SHALL offer Retry and identify any previous usable image. Log retention/truncation SHALL be explicit.

#### Scenario: Reopen during a build

- **WHEN** a user leaves build details and returns while the build continues
- **THEN** the page shows the same build and its current timeline without restarting it

#### Scenario: Server restarts during build

- **WHEN** an active build has no confirmed result after server restart
- **THEN** the retained build is shown as interrupted with a retry path and no false success
