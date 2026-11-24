## ADDED Requirements

### Requirement: Desktop applications belong to the bot desktop

The bot container SHALL provide an explicit launcher for installed graphical applications. It SHALL launch as `bot` on that bot's desktop outside agent and tool process groups, with independent standard streams. Applications SHALL remain running when the requesting execution completes, stops, suspends, times out, or crashes. Stopping the bot container SHALL end these applications. Closing an application SHALL leave it closed until another explicit launch request.

The launcher SHALL accept bounded application identifiers and argument arrays without evaluating shell text. Invalid requests and unavailable executables SHALL return actionable failures. Launch acceptance SHALL mean only that process creation was requested successfully; it SHALL NOT claim the window appeared or a document loaded. Application output SHALL be available in bot-local diagnostics. Applications SHALL receive desktop environment values without execution credentials or session capabilities. Launch requests from agents SHALL retain execution-capability and shared-work checks.

#### Scenario: Unsaved workbook survives a completed execution
- **WHEN** a bot opens Gridcraft using the desktop launcher, edits an unsaved workbook, and completes its execution
- **THEN** Gridcraft and the workbook remain open for the next execution and the user

#### Scenario: Execution is interrupted
- **WHEN** an execution that requested a desktop application is stopped, suspended, timed out, or crashes
- **THEN** the desktop application remains open while session-owned commands are cleaned up

#### Scenario: Application is explicitly closed
- **WHEN** the user closes a launched application
- **THEN** the launcher does not restart it automatically

#### Scenario: Bot container stops
- **WHEN** the bot container stops with desktop applications open
- **THEN** those application processes end and no promise is made to recover unsaved documents

#### Scenario: Invalid request or missing application
- **WHEN** a request exceeds its bounds, has an invalid application identifier or argument shape, or names an unavailable executable
- **THEN** the launcher rejects it with actionable diagnostics without evaluating shell text

#### Scenario: Launch credentials and ownership
- **WHEN** an agent requests an application launch
- **THEN** the request requires its current execution capability and work ownership, and the application runs as the owning bot without execution credentials or session capabilities
