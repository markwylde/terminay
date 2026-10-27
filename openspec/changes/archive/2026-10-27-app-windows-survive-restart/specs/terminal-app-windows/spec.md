## MODIFIED Requirements

### Requirement: Windows belong to one terminal session

An app window SHALL belong to exactly one terminal session: the session whose MCP capability made the call that opened it. The server SHALL own every window record, holding its identity, title, source, content, the tool input and result it was opened with, and whether it is open or minimised. A window SHALL be reachable only through its owning session and SHALL NEVER be listed, shown, or addressed from another terminal, project, or server. A session SHALL hold at most eight windows; opening another SHALL fail with a bounded error and change nothing. A window SHALL end when the user closes it, when the agent closes it, or when its session ends, and SHALL last exactly as long as its session does, across server restarts included.

#### Scenario: Window opened by an agent in Terminal 1

- **WHEN** an agent in Terminal 1 opens a window
- **THEN** the window appears in Terminal 1's pane and in no other terminal's pane

#### Scenario: Another terminal names the window

- **WHEN** a call from Terminal 2 names a window that belongs to Terminal 1
- **THEN** the call fails as though the window does not exist and Terminal 1's window is unchanged

#### Scenario: Ninth window

- **WHEN** a session that holds eight windows opens another
- **THEN** the call fails with a bounded error and the eight windows are unchanged

#### Scenario: Terminal closed

- **WHEN** a terminal session that owns windows ends
- **THEN** its windows end with it

## ADDED Requirements

### Requirement: Windows outlive a server restart with their terminal

The server SHALL write each window's record to its data directory whenever the record changes, and SHALL remove it when the window ends. A written record SHALL hold the window's id, owning session and project, title, source, open or minimised state, document, data, content security policy, permissions, tool definition, tool input, tool result, and tool cancellation, and nothing else: no pending model context, message in flight, upload, held view response, or mirror recording. When the server starts, after held terminal sessions are reattached, it SHALL restore every written window whose owning session is running, with the same id and record, and SHALL discard every other written window. A window whose MCP App tool call had neither a result nor a cancellation when the server stopped SHALL be restored with that call cancelled. A restored view SHALL start from its document as a newly opened view does; what a person typed into the view, where it was scrolled, and state the view kept in its own script SHALL NOT be restored. Quitting while keeping terminals running SHALL NOT end windows. A written record that cannot be read or is not valid SHALL be discarded without affecting any other window or the server's start.

#### Scenario: Relaunch with the terminal kept

- **WHEN** an agent's terminal has an open window and a minimised window, and the person quits Terminay keeping terminals running and opens it again
- **THEN** that terminal comes back with both windows, the first open and the second minimised, each showing its document

#### Scenario: The agent addresses a restored window

- **WHEN** the agent in that terminal replaces or closes a window it opened before the restart, by the id it was given
- **THEN** the call acts on the restored window

#### Scenario: Relaunch with the terminal ended

- **WHEN** the person quits Terminay choosing to end terminals, or a terminal's shell exits while Terminay is closed, and Terminay is opened again
- **THEN** no window of that terminal is restored and nothing of it remains in the data directory

#### Scenario: An MCP App window is restored

- **WHEN** a terminal with an MCP App window whose tool call had returned comes back after a restart
- **THEN** the window shows the view started from the same tool input and tool result, and a call the view makes to its MCP server fails with the ordinary error until that server is connected again

#### Scenario: A tool call was running at quit

- **WHEN** a terminal comes back after a restart with an MCP App window whose tool call had not returned
- **THEN** the window is restored and its view is told the call was cancelled

#### Scenario: A view starts fresh

- **WHEN** a person typed into a field of a view and Terminay is restarted with that terminal kept
- **THEN** the restored view shows its document as it was given, without the typed text

#### Scenario: A damaged record

- **WHEN** one written window record is unreadable when the server starts
- **THEN** that window is discarded, every other window of running terminals is restored, and the server starts as usual

#### Scenario: Reload without a restart

- **WHEN** the workspace reloads while the server keeps running
- **THEN** every window is shown again in the same open or minimised state
