## MODIFIED Requirements

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
- chats, conversations, chat UI, chat MCP capabilities and approvals
- bots, containers and images, native CLI drivers and event translation, sessions, credential injection, execution tools and bot UI
- extension process lifetime and crash backoff
- Electron-versus-standalone packaging

An extension SHALL supply session facts, MCP registration knowledge, declared language-server/worktree insight runtimes, chat-provider turns and declarative bot-agent descriptions. Bot descriptions SHALL name a supported host-owned native driver, exact install versions, credentials, models, availability and bounded launch settings. They SHALL NOT implement process ownership, arbitrary wire parsers, credential access or bot UI.

#### Scenario: Extension attempts a host behaviour

- **WHEN** an extension attempts to render sidebar UI, navigate the workspace,
  bind a session to a terminal, or order canonical events
- **THEN** no such API is available to it

#### Scenario: Provider responsibilities

- **WHEN** a session source package is authored
- **THEN** it implements session detection, harness reporting, bounded snapshots, and privacy exclusions, and nothing else

#### Scenario: Bot agent responsibilities

- **WHEN** a bot extension contributes a supported native CLI agent
- **THEN** it describes the runtime and answers model/status/launch queries, while the server starts and controls the execution and owns credentials and diagnostic translation

#### Scenario: Unsupported native driver

- **WHEN** a bot extension declares an unknown native driver or an arbitrary protocol implementation
- **THEN** contribution validation rejects it before a bot execution starts

#### Scenario: Chat provider responsibilities

- **WHEN** a chat provider is authored
- **THEN** it reports availability and runs sessions and turns, and cannot read or change a chat's conversation, reach or approvals
