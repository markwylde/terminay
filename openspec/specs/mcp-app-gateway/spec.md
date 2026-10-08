# mcp-app-gateway Specification

## Purpose
Terminay connects to the MCP servers the user adds in Settings as a UI-capable client, offers their tools through the Terminay MCP server, and opens a tool's view as a window in the calling terminal that reaches only its own server.

## Requirements

### Requirement: Connected MCP servers setting

Settings > AI SHALL list **Connected MCP servers** below the Terminay MCP permission policies. The user SHALL be able to add, edit, disable, and remove an entry. An entry SHALL have a unique name of lowercase letters, digits, and hyphens, and either a command with arguments and environment variables to run a local server, or an `http` or `https` URL with request headers for a remote one. The list SHALL be a server-owned setting of the server that owns the MCP endpoint, SHALL apply to every project on that server, and SHALL be shown and changed identically from desktop, web, and mobile clients. Changing it SHALL require the same authority as changing the MCP permission policies. Environment-variable values and header values SHALL be stored in the server vault and SHALL NEVER be returned to a client after they are saved.

#### Scenario: Adding a local server

- **WHEN** a user adds an entry named `diagrams` with a command and arguments
- **THEN** the entry is listed on every client attached to that server

#### Scenario: Secret value after save

- **WHEN** a user saves an entry with a header value and reopens it
- **THEN** the value is shown as set and its content is not sent to the client

#### Scenario: Duplicate name

- **WHEN** a user adds an entry whose name is already used
- **THEN** the entry is rejected and the list is unchanged

### Requirement: Terminay connects as a UI-capable client

For each enabled entry the server SHALL act as that MCP server's client and SHALL advertise the `io.modelcontextprotocol/ui` extension with the `text/html;profile=mcp-app` content type. A local server SHALL be connected once per project, started when a terminal of that project first needs its tools, with the project root as its working directory, and stopped when the entry is disabled, removed, or changed, or when the project closes. A remote server SHALL be connected once per Terminay Server. Terminay SHALL NOT read, write, or depend on any agent CLI's own MCP configuration to do this.

#### Scenario: First tool listing in a project

- **WHEN** an agent in a project lists Terminay's tools for the first time and a local entry is enabled
- **THEN** the server starts that entry's process in the project root and offers its tools

#### Scenario: Entry disabled

- **WHEN** a user disables an entry
- **THEN** its connections are closed, its processes stop, and its tools are no longer offered

#### Scenario: Agent's own configuration

- **WHEN** an agent CLI has its own MCP configuration
- **THEN** Terminay neither reads nor changes it

### Requirement: Connection status and failure

Each entry in Settings SHALL show whether it is connected, the number of tools it offers, and, when it is not connected, a bounded reason. A server that fails to start, fails its handshake, or exceeds the connection time bound SHALL contribute no tools and SHALL NOT prevent Terminay's own tools or other entries' tools from being listed. A lost connection SHALL be re-established on the next tool listing or call that needs it, and SHALL NOT be retried on a timer.

#### Scenario: Server fails to start

- **WHEN** an entry's command cannot be run
- **THEN** Settings shows the entry as not connected with the reason, and Terminay's own tools and other entries' tools are still listed

#### Scenario: Connection lost

- **WHEN** a connected server's process exits
- **THEN** its status shows not connected and the next call that needs it starts it again

### Requirement: Upstream tools are offered through the Terminay MCP server

The Terminay MCP server SHALL list each connected entry's model-visible tools alongside its own, named `<entry-name>__<tool-name>`, with the tool's own description and input schema. A tool the upstream server marks as visible only to its app SHALL NOT be listed. When the set of offered tools changes, the stdio adapter SHALL notify the agent that the tool list changed. A call SHALL be forwarded to the upstream server with its arguments unchanged, and the upstream result SHALL be returned to the agent. A result larger than 1 MiB SHALL be replaced by a bounded error naming the tool.

#### Scenario: Tool of a connected server

- **WHEN** entry `diagrams` offers a tool `draw`
- **THEN** the agent sees `diagrams__draw` in Terminay's tool list and calling it runs `draw` on that server

#### Scenario: App-only tool

- **WHEN** an upstream tool is marked visible only to its app
- **THEN** it is absent from the tool list the agent sees

#### Scenario: Oversized result

- **WHEN** an upstream tool returns more than 1 MiB
- **THEN** the agent receives a bounded error naming the tool

### Requirement: A tool with a UI opens a window in the calling terminal

When the agent calls an upstream tool that declares a UI resource, and App Windows is permitted, the server SHALL read that resource from the upstream server and open a window in the calling terminal whose view is that resource, titled with the tool's title. The view SHALL receive the call's arguments and then its result. The agent SHALL receive the tool's result with a first line stating that an interactive view is shown to the user. A UI resource SHALL be at most 4 MiB and SHALL have the MCP Apps HTML content type; otherwise no window opens and the agent still receives the tool's result. If the tool call fails or is cancelled, the view SHALL be told it was cancelled.

#### Scenario: Agent calls a tool with a UI

- **WHEN** an agent in Terminal 1 calls `diagrams__draw` and that tool declares a UI resource
- **THEN** a window titled with the tool's title opens in Terminal 1 showing that UI, the view receives the arguments and the result, and the agent's result starts by saying a view is shown

#### Scenario: App Windows not permitted

- **WHEN** App Windows is Never Allow and an agent calls a tool that declares a UI
- **THEN** the tool runs, no window opens, and the agent receives the tool's ordinary result

#### Scenario: Resource too large

- **WHEN** a tool's UI resource exceeds 4 MiB
- **THEN** no window opens and the agent receives the tool's ordinary result

### Requirement: A view reaches only its own server

A tool call or resource read made by an MCP App view SHALL be forwarded only to the upstream server that supplied the view, over the connection of the window's project, and only for a tool that server marks as visible to its app. Each such call SHALL be evaluated under the Connected Server Tools policy and SHALL be bounded in size and lifetime like an agent's call. A view SHALL NOT call Terminay's own tools or another entry's tools.

#### Scenario: View polls its server

- **WHEN** a view calls an app-visible tool of its own server
- **THEN** the call is forwarded and the result returns to the view

#### Scenario: View calls another server's tool

- **WHEN** a view requests a tool that belongs to another entry or to Terminay
- **THEN** the request is refused and nothing is called

#### Scenario: View calls a model-only tool

- **WHEN** a view requests a tool its server does not mark as visible to the app
- **THEN** the request is refused

### Requirement: Gateway boundaries

Upstream connections SHALL be made only from the Terminay Server. A client SHALL NOT connect to an upstream server, and an upstream server SHALL NOT receive a Terminay capability token, the identity of the calling terminal, or any Terminay protocol access. Terminay SHALL NOT offer an upstream server's prompts, and SHALL read an upstream resource only to serve a UI resource or a view's own read. The gateway SHALL NOT make the Terminay MCP endpoint reachable over a network.

#### Scenario: Upstream environment

- **WHEN** a local upstream server is started
- **THEN** its environment contains no Terminay control socket path or capability token

#### Scenario: Remote discovery

- **WHEN** a remote party attempts to reach the Terminay MCP endpoint over a network after entries are configured
- **THEN** no network MCP endpoint exists

### Requirement: Stored credentials stay with their destination

A connected server's stored credentials SHALL be used only for the destination they were saved for. When an entry's command, arguments, address, or transport is changed, credentials that are not supplied again with the change SHALL be removed, not carried to the new destination. A change that leaves the destination alone, such as a rename or enabling, SHALL keep them. The settings form SHALL say so wherever stored values are shown. For a local server the destination is its command and arguments; its other variables are not part of it, so a client that may save entries can still change them. That client may already start any command as the same user.

#### Scenario: A remote server's address is changed

- **WHEN** an entry with a stored `Authorization` header is saved with a different address and no header values
- **THEN** the stored header is removed, and nothing is sent to the new address with it

#### Scenario: An entry is renamed

- **WHEN** an entry with stored credentials is saved under a new name with the same command and arguments
- **THEN** its credentials are kept

### Requirement: A server that fails is not restarted in a loop

A connected server that fails to start, or that connects and then ends, SHALL be left alone for a period before a listing of tools starts it again. Announcing that the set of tools changed SHALL happen when a server's state changes, not each time it fails the same way. Saving the server's entry, or asking for one of its tools by name, SHALL try it at once. One caller abandoning its wait SHALL NOT fail a connection another caller is waiting for. A server that has gone away SHALL keep the tools it last offered on the list, so that an agent can still ask for one, which starts it again; they SHALL be dropped when its entry changes or is disabled. An entry changed while its earlier version is still connecting SHALL be tried afresh, and SHALL NOT be charged with the earlier attempt.

#### Scenario: A server exits as soon as it has connected

- **WHEN** a connected server completes its handshake and then exits, while an agent's adapter is waiting to hear of changes to the tool list
- **THEN** the server is not started again by the listing that the change provokes, and is started when a tool of it is next asked for or after it has been left alone for a while

#### Scenario: A server that cannot start

- **WHEN** an agent lists tools five times while one connected server cannot start
- **THEN** that server is started once, and the tool list is not announced as changed after the first failure
