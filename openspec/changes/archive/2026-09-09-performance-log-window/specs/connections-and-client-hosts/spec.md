# connections-and-client-hosts Delta

## ADDED Requirements

### Requirement: Connection window loading state and startup phase line

A newly opened Desktop connection window SHALL remain in the normal loading state until its own local or remote server connection is ready. The loading state SHALL centre the Terminay mark in the window above a looping five-dot loading indicator, with five fixed, contrasting colours from the tab hue palette entering in sequence. Desktop packaging, browser metadata, and visible web surfaces SHALL use the same square mark geometry: a pure-black background with even horizontal and vertical padding around the white glyph. Beneath the indicator the loading state SHALL show a single short line: for local embedded-server startup it names the startup phase currently running, and for remote connections it carries that connection's short status message. The line SHALL be a bounded, product-authored string with no path, identifier, host, credential, or error detail, and it SHALL be visually subordinate to the mark and indicator. Native window controls SHALL never overlap the loading state.

#### Scenario: Remote loading shows a status message

- **WHEN** a remote connection window is loading
- **THEN** the mark, five-dot indicator, and a short status message are shown

#### Scenario: Local loading names the current phase

- **WHEN** the Local embedded server is starting
- **THEN** the mark and five-dot indicator are shown with a single short line naming the startup phase currently running
- **AND** that line carries no path, identifier, host, credential, or error detail

#### Scenario: Mark and indicator are unchanged by the line

- **WHEN** the phase line is shown, changes, or is absent
- **THEN** the mark geometry, the five dot colours, and their sequence are unaffected
- **AND** native window controls do not overlap the loading state

## MODIFIED Requirements

### Requirement: Startup paint sequence

At local Desktop startup, a self-contained native loading document SHALL paint the loading state immediately after Electron is ready, before workspace restoration, extension setup, or server initialization begins. The loading document SHALL finish painting and the native window SHALL be shown before that restoration starts. As startup phases advance, Desktop SHALL update the phase line in that document without granting it script execution or network access, and each update SHALL keep the dot animation in phase so the indicator never visibly restarts. Updating the phase line SHALL NOT delay the phase it names, and a failed update SHALL leave the previously painted loading state intact rather than blanking the window. The verified server UI SHALL replace the loading document once its session is ready, and its initial document SHALL paint the same loading state before the renderer bundle evaluates, keeping the dot animation in phase through that handoff so startup never presents an empty window or a visibly restarted loader. The originating window SHALL keep its existing server binding during that handoff.

#### Scenario: No empty window at startup

- **WHEN** Desktop starts and hands off from the native loading document to the server UI
- **THEN** the dot animation stays in phase and no empty window or restarted loader is shown

#### Scenario: Window is shown before restoration

- **WHEN** Electron becomes ready
- **THEN** the loading document paints and the window is shown before workspace restoration begins

#### Scenario: Phase line advances in place

- **WHEN** a startup phase ends and the next begins
- **THEN** the phase line names the new phase and the dot animation stays in phase
- **AND** the loading document still has no script execution or network access

#### Scenario: Phase update fails

- **WHEN** updating the phase line fails
- **THEN** the previously painted loading state remains visible
- **AND** the startup phase it would have named is not delayed

## REMOVED Requirements

### Requirement: Connection window loading state

**Reason**: Replaced by **Connection window loading state and startup phase line**, which keeps the mark, indicator, colours, and non-overlap rules unchanged but retires the rule that local embedded-server startup shows no text. That rule is what prevents a user from seeing which startup phase is slow.

**Migration**: None for users or data. The remote status message keeps its existing slot and content; local startup now fills the same slot with the current phase name.
