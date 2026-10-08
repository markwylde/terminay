## ADDED Requirements

### Requirement: show_window loads a document from a file and carries data

`show_window` SHALL take its HTML document either inline as `html` or as `html_file`, the absolute path of a file, and SHALL refuse a call that gives both or neither. For `html_file` the stdio adapter SHALL read the file itself, in the agent's own process tree and with the agent's own filesystem authority, and SHALL send its contents as the document; the path SHALL NEVER be sent to, or opened by, the Terminay Server. The adapter SHALL read only a regular file of at most 512 KiB that is valid UTF-8, and SHALL otherwise fail the call with a bounded error that names the reason and not the file's contents. The contents of the file SHALL NEVER appear in the tool's result.

`show_window` SHALL also take an optional `data`, a JSON value of at most 64 KiB when serialised, stored on the window record for the view to read. Replacing a window's content SHALL replace its data. The tool's description SHALL tell the agent that a saved document with `data` avoids writing the document out again, and how the document reads the data.

#### Scenario: A saved questionnaire

- **WHEN** an agent calls `show_window` with a title, `html_file` naming a saved questionnaire document, and `data` holding three questions
- **THEN** a window opens showing that document with those three questions, and the call returns its handle without the document's contents

#### Scenario: Both html and html_file

- **WHEN** an agent calls `show_window` with both `html` and `html_file`
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: File missing

- **WHEN** an agent calls `show_window` with an `html_file` that does not exist
- **THEN** the call fails with a not-found error and no window is created

#### Scenario: Not a regular file

- **WHEN** an agent calls `show_window` with an `html_file` that names a directory, a device, or a named pipe
- **THEN** the call fails with a bounded error, nothing is read from it, and no window is created

#### Scenario: File too large

- **WHEN** an agent calls `show_window` with an `html_file` over 512 KiB
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: Data too large

- **WHEN** an agent calls `show_window` with `data` over 64 KiB
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: The server never sees the path

- **WHEN** an agent calls `show_window` with `html_file`
- **THEN** the request the adapter sends to the Terminay Server carries the document and no path

## MODIFIED Requirements

### Requirement: MCP security and privacy boundaries

Terminay's own MCP tools SHALL expose terminal control, automation management, and the calling terminal's app windows only; filesystem, Git, settings, secrets, recordings, extension administration, remote administration, and arbitrary native-window management SHALL remain outside Terminay's own tool surface. The single file read in that surface is the stdio adapter reading the document an agent names for `show_window`: it is performed by the adapter and never by the Terminay Server, its contents are shown to the user in a window, and they SHALL NEVER be returned to the agent. The surface MAY additionally carry the tools of MCP servers the user has connected in Settings; such a tool SHALL be named with its entry's prefix, SHALL be run by that server and never by Terminay, and SHALL NOT gain any Terminay authority. Every request SHALL revalidate its capability against canonical terminal and project state and SHALL be evaluated against the MCP permission policy before it is dispatched. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** an agent seeks filesystem, Git, settings, secret, recording, extension-management, or remote-administration access through Terminay's own tools
- **THEN** no such Terminay tool exists in the surface

#### Scenario: Agent names a file it wants to read

- **WHEN** an agent calls `show_window` with `html_file` naming a file that is not an HTML document, such as a private key
- **THEN** the file's text is shown to the user in a window, and neither the tool result nor any later tool result carries it to the agent

#### Scenario: Connected server offers a file tool

- **WHEN** a server the user connected offers a tool that reads files
- **THEN** it is listed under that entry's prefix, runs in that server, and holds no Terminay capability

#### Scenario: Authority from UI focus

- **WHEN** a request would be satisfied only by current UI focus or renderer ownership
- **THEN** the server does not infer authority from it

#### Scenario: Agent status via MCP

- **WHEN** MCP calls execute
- **THEN** no journal record is routed through MCP and no agent-status lifecycle event is synthesized

#### Scenario: Automation management requires permission

- **WHEN** an agent calls an automation-management tool
- **THEN** the server evaluates the MCP permission policy for it before any automation changes
