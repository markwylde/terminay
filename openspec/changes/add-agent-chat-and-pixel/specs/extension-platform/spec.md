## ADDED Requirements

### Requirement: Agent chat permission

A chat provider SHALL require the `agent-chat` permission. `agent-chat` SHALL authorize registering the declared chat providers and receiving, for each provider session, the host-supplied working directory, instruction and MCP server entry. It SHALL NOT grant client authority, direct canonical-store mutation, access to chats other than the sessions the host opens with that provider, or the ability to mint, widen or read a capability token other than the one inside the supplied MCP server entry.

#### Scenario: Missing permission

- **WHEN** a package declares a chat provider without `agent-chat`
- **THEN** manifest validation fails

### Requirement: Chat provider contribution and registration

A package SHALL declare each chat provider under `contributes.agentChatProviders`. Each declaration SHALL carry a namespaced provider id, a display name and its supported platforms. At activation, the extension SHALL register each declared provider through `context.agents.registerChatProvider(id, runtime)`, which SHALL return a disposable registration. Registration SHALL be refused for an undeclared id, a duplicate id, or a registration after deactivation. The runtime SHALL implement:

- `availability(signal)`: returns available, or unavailable with one of `not_installed`, `not_signed_in` or `unsupported_platform`, plus a bounded detail;
- `openSession(request, events, signal)`: starts one provider session from the host's request, which holds an opaque session id, the working directory, a bounded instruction, and an MCP server entry or none;
- on a session: `prompt(text, signal)` to run one turn, `cancel()` to stop the running turn, and `close()` to end the session.

Through `events` the provider SHALL report:

- reply text deltas;
- tool activity, as the MCP server and tool name for an MCP tool or a bounded tool kind for anything else, with an opaque call id and a running, completed or failed state;
- turn completion;
- failures, with a reason of `not_installed`, `not_signed_in`, `crashed` or `failed` and a bounded detail;
- session exit.

The host SHALL validate and bound every event. It SHALL drop events for sessions it did not open or has closed. A provider's events SHALL NEVER carry tool arguments or results to clients.

#### Scenario: Registering a declared provider

- **WHEN** an extension registers a chat provider id its manifest declared
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Event for a closed session

- **WHEN** a provider reports text for a session the host has already closed
- **THEN** the host drops it and no chat changes

### Requirement: Chat provider sessions in the extension host

Provider sessions SHALL run inside the extension's child process. The agent processes they start SHALL be children of that process, and SHALL count toward the extension's crash containment. The host SHALL own each session's lifetime: it opens, prompts, cancels and closes sessions, and every call carries a cancellation signal. When the extension child exits, is quarantined, is disabled or is updated, the host SHALL treat each of its open sessions as ended unexpectedly. The extension SHALL kill the agent processes of a session that is closed, and of every session when it is deactivated.

#### Scenario: Extension child crashes mid-turn

- **WHEN** the extension child running a chat's provider session crashes during a turn
- **THEN** the chat records that its agent stopped, the chat's capability is revoked, and the next message opens a new session once the extension is running again

#### Scenario: Session closed

- **WHEN** the host closes a provider session
- **THEN** the extension ends that session's agent process

### Requirement: Chat providers confine their agents

A chat provider SHALL start its agent so that it can act only through the MCP server entry the host supplied:

- it disables the agent's built-in tools where the agent offers that;
- it loads no other MCP server and no user or project MCP configuration;
- it declines every request to use any other tool;
- it keeps no session history on disk where the agent offers that;
- it writes nothing to the agent's configuration, settings, hooks or credential files.

A provider MAY rely on the agent's existing login. A provider SHALL start the agent's executable as installed on the server account, from the server's environment. It SHALL NOT download an agent at run time.

#### Scenario: No MCP entry

- **WHEN** the host opens a session with no MCP server entry
- **THEN** the provider starts the agent with no MCP servers and no built-in tools, so it can only converse

#### Scenario: Configuration untouched

- **WHEN** a provider session is opened, used and closed
- **THEN** no file under the agent's configuration directory has been written by the provider

## MODIFIED Requirements

### Requirement: Bounded API scope

The public API SHALL support session sources, MCP install targets, language servers, worktree insights, and chat providers. Themes, editor plugins, autocomplete sources, arbitrary commands, renderer components, and generic Server Core operation registration SHALL be out of scope.

#### Scenario: Unsupported contribution kind

- **WHEN** a package declares a theme, editor plugin, autocomplete source,
  arbitrary command, renderer component, or generic Server Core operation
- **THEN** the contribution is not supported and validation rejects it

#### Scenario: Language server contribution

- **WHEN** a package declares a language server contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Session source contribution

- **WHEN** a package declares a session source or MCP install target contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Worktree insight contribution

- **WHEN** a package declares a worktree insight contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Chat provider contribution

- **WHEN** a package declares a chat provider contribution
- **THEN** it is a supported contribution kind and validation accepts it

### Requirement: Contribution arrays

`contributes.agentSessionSources`, `contributes.mcpInstallTargets`, `contributes.languageServers`, `contributes.worktreeInsights`, and `contributes.agentChatProviders` SHALL be the supported contribution arrays, and at least one supported contribution SHALL be required.

#### Scenario: Agent-only package

- **WHEN** a package contributes one or more session sources
- **THEN** it passes contribution validation

#### Scenario: No contributions

- **WHEN** a package declares no contribution array
- **THEN** validation fails

#### Scenario: Language-server-only package

- **WHEN** a package contributes one or more language servers and nothing else
- **THEN** it passes contribution validation

#### Scenario: Worktree-insight-only package

- **WHEN** a package contributes one or more worktree insight sources and nothing
  else
- **THEN** it passes contribution validation

#### Scenario: Chat-provider-only package

- **WHEN** a package contributes one or more chat providers and nothing else
- **THEN** it passes contribution validation

### Requirement: Host-owned behaviours excluded from extension authorship

Terminay SHALL own all of these, and the API SHALL offer an extension no means of implementing them:

- sidebar components and styling
- project scoping and worktree resolution
- terminal binding
- project and terminal navigation
- client subscriptions and remote transport
- acknowledgement and unread behaviour
- canonical ordering
- extension enable and disable surfaces, and harness switch surfaces
- the MCP install surface
- chats, conversations, chat UI, MCP capability minting for chats, and approvals
- extension process lifetime and crash backoff
- Electron-versus-standalone packaging

An extension SHALL supply only session facts, MCP registration knowledge, and the running of chat provider turns.

#### Scenario: Extension attempts a host behaviour

- **WHEN** an extension attempts to render sidebar UI, navigate the workspace,
  bind a session to a terminal, or order canonical events
- **THEN** no such API is available to it

#### Scenario: Provider responsibilities

- **WHEN** a session source package is authored
- **THEN** it implements session detection, harness reporting, bounded snapshots, and privacy exclusions, and nothing else

#### Scenario: Chat provider responsibilities

- **WHEN** a chat provider is authored
- **THEN** it reports availability and runs sessions and turns, and it cannot read or change a chat's conversation, reach or approvals

### Requirement: Public extension API capabilities for agent extensions

The API SHALL permit an extension to:

- define redacted profile types
- contribute declarative status, progress, confirmation, and lifecycle surfaces
- receive its own namespaced configuration, data, and cache directories
- request resolution of its own profile-bound secret fields through a scoped broker
- implement runtime callbacks through bounded typed IPC with cancellation, deadlines, and concurrency limits
- contribute a session source and publish bounded machine-wide session snapshots
- contribute MCP install targets that receive the host-supplied MCP server command
- contribute chat providers that run host-opened sessions and stream bounded turn events

#### Scenario: Runtime callback bounds

- **WHEN** an MCP install target callback runs
- **THEN** it is subject to cancellation, deadlines, and concurrency limits over bounded typed IPC

#### Scenario: Publishing agent lifecycle events

- **WHEN** a session source publishes snapshots
- **THEN** they are validated before they reach the host-owned canonical projection

#### Scenario: Streaming chat events

- **WHEN** a chat provider streams turn events
- **THEN** they are validated and bounded before they reach the host-owned conversation
