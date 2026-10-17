## ADDED Requirements

### Requirement: Server-owned chats

The server SHALL own every agent chat. A chat SHALL have:

- an opaque chat id;
- a display title;
- an optional key that a client supplies to find the same chat again, unique on the server;
- the id of the chat provider that runs it;
- an MCP reach fixed when the chat is created: `none`, one project, or `workspace`;
- a conversation;
- a status of `idle`, `thinking` or `streaming`.

The server SHALL hold each chat's provider session, its MCP capability and its conversation. No client SHALL launch, address or hold an agent process. A key and a title SHALL be labels only: neither SHALL confer authority, select a scope, or select a provider. The server SHALL hold at most a fixed number of open chats. Creating one beyond that limit SHALL fail with a stable `chat_limit_reached` error.

#### Scenario: Creating a chat

- **WHEN** a client with terminal-create authority creates a chat titled "Build helper" with the `claude-code` provider and reach limited to project "api"
- **THEN** the server creates the chat, returns its id, and every attached client sees it in the chat list

#### Scenario: Opening a chat by key

- **WHEN** a client opens the chat with key `pixel` and one already exists on the server
- **THEN** the client receives the existing chat, and no new chat is created

#### Scenario: Too many chats

- **WHEN** the server already holds its limit of open chats and a client creates another
- **THEN** creation fails with `chat_limit_reached` and nothing else changes

### Requirement: Chat operations and authority

The server SHALL offer core operations to:

- list chat providers and whether each is available;
- list chats;
- read one chat's conversation and status;
- create a chat;
- open a chat by key, creating it with the given provider, title and reach when it does not exist;
- send a message;
- stop the turn in progress;
- clear a conversation;
- close a chat;
- decide a chat approval.

The server SHALL also publish events that carry chat-list changes, conversation changes and streamed deltas with a revision, so that a client which misses an event can resynchronise by reading the chat. Every operation and event SHALL require terminal-create authority on the owning server. A client without it SHALL be shown no chats and SHALL have its chat operations refused. A chat operation SHALL NEVER address a chat on another server.

#### Scenario: Viewer without authority

- **WHEN** a client without terminal-create authority lists chats or sends a message
- **THEN** the request is refused and it receives no chat events

#### Scenario: Missed events

- **WHEN** a client's event stream skips a revision for a chat
- **THEN** the client reads the chat and shows the server's current conversation

### Requirement: Shared ephemeral conversations

Every client attached to the owning server SHALL see the same chats and the same conversations. A reply streaming in a chat SHALL stream to every client showing that chat. Only one turn SHALL run in a chat at a time. A message sent while a turn is running SHALL be refused with a stable `chat_busy` error, and the client SHALL keep the text in its input. Chats and conversations SHALL be held only in server memory. They SHALL NOT be written to disk, workspace state, settings, logs, diagnostics or client storage, and a server restart SHALL start with no chats.

#### Scenario: Two clients

- **WHEN** the desktop and a phone show the same chat and the user sends a message from the desktop
- **THEN** the phone shows the message and the streaming reply

#### Scenario: Message while busy

- **WHEN** a turn is running in a chat and a client sends another message to it
- **THEN** the send fails with `chat_busy` and the running turn continues

#### Scenario: Server restart

- **WHEN** the server restarts
- **THEN** no chats exist and no conversation text is found in the server's data directory

### Requirement: Conversation model

A conversation SHALL be an ordered list of entries:

- **user** messages;
- **assistant** messages, which hold reply text interleaved with tool activity notes;
- **approval** entries, which hold a pending or decided approval for the chat's MCP calls;
- **notice** entries, which Terminay writes about the chat itself, such as a provider failure.

Each entry SHALL have a stable id and creation time. Each text field SHALL be bounded, and the conversation SHALL keep a bounded number of entries, dropping the oldest. Clear SHALL cancel any running turn, end the provider session, revoke the chat's capability, and empty the conversation. The next message SHALL then start a new provider session with a newly minted capability. Close SHALL do the same and remove the chat.

#### Scenario: Clear

- **WHEN** the user clears a chat that has a conversation and a session grant
- **THEN** every client shows an empty conversation, the old capability and its grants are revoked, and the next message starts a new provider session

#### Scenario: Close

- **WHEN** a client closes a chat
- **THEN** the chat disappears from every client and its provider session and capability end

### Requirement: Turns, streaming and stop

Sending a message SHALL append the user entry and start a turn. When the chat has no provider session, the server SHALL first open one through its provider. While the turn waits for its first output, the chat's status SHALL be `thinking`. While reply text arrives, it SHALL be `streaming`. When the turn ends, it SHALL return to `idle`. Stop SHALL cancel the provider's turn and any pending approval in the chat, keep the text already received, and return the chat to `idle`. A turn SHALL have no time limit while it is making progress. A provider that reports nothing for a fixed period SHALL fail the turn with a notice.

#### Scenario: Streaming reply

- **WHEN** the user sends "what's in my build terminal?"
- **THEN** the chat shows `thinking`, then streams the reply text with status `streaming`, then returns to `idle`

#### Scenario: Stop

- **WHEN** the user presses Stop while a reply is streaming
- **THEN** the provider turn is cancelled, the text so far stays, and the chat is `idle` on every client

### Requirement: Tool activity in the conversation

Each tool call that the provider reports SHALL appear in the assistant message as a one-line activity note. For a Terminay MCP tool, the server SHALL build the note from its own tool name and, for a terminal, that terminal's display title, which it looks up from the handle. Examples are "Reading build" and "Running `npm test` in api". For any other tool, the note SHALL use only a provider-supplied tool kind, bounded and sanitised. Activity notes SHALL NOT include terminal output or tool results. Terminal output reaches the conversation only in the agent's reply text.

#### Scenario: Reading a terminal

- **WHEN** the agent calls `read_terminal` on the terminal titled "build"
- **THEN** the assistant message shows the activity note "Reading build" and no terminal output

### Requirement: Chat MCP reach

A chat with reach `none` SHALL be run with no MCP server, and it SHALL NOT receive a capability. A chat with project or workspace reach SHALL receive its own MCP capability with that scope, minted by the server when its provider session opens and revoked when the session ends. The provider SHALL receive it only as the host-supplied MCP server entry. A project reach SHALL name a project that exists on the owning server when the chat is created. Creating a chat with any reach SHALL require only terminal-create authority, the same authority that can already open a terminal on the server.

#### Scenario: Chat without MCP

- **WHEN** a chat with reach `none` is asked to read a terminal
- **THEN** its provider has no Terminay tools, and the agent can only answer from the conversation

#### Scenario: Project reach

- **WHEN** a chat with reach limited to project "api" calls `list_terminals`
- **THEN** it receives only the terminals of project "api"

### Requirement: Chat agents act only through Terminay MCP

A chat's agent SHALL be able to act on the machine only through the MCP server the host supplies, and only when the chat has MCP reach. The host SHALL start each provider session in an empty working directory, owned by the server account and private to that chat. Every chat provider SHALL satisfy all of the following, as a contract the extension platform states:

- it disables the agent's built-in tools wherever the agent offers that;
- it loads no MCP server other than the one the host supplied;
- it declines every request to use any other tool without showing it to the user;
- it writes nothing to, and does not modify, the agent's own configuration, hooks or settings files.

MCP calls from the chat SHALL be governed by the server's MCP permission policy exactly as a terminal agent's are.

#### Scenario: Agent asks for a shell

- **WHEN** a chat agent asks to run a shell command outside Terminay MCP
- **THEN** the request is declined and no command runs

#### Scenario: Agent types into a terminal under Ask

- **WHEN** Full Terminal Management is Ask Permission and a chat agent calls `write_terminal`
- **THEN** an approval entry appears in that chat and nothing is written until a user allows it

### Requirement: Approvals in the chat

A pending approval whose calling capability belongs to a chat SHALL appear as an approval entry in that chat on every client that shows it. The entry SHALL carry the statement and full details that the MCP permission capability requires, and the actions **Allow One Time**, **Allow This Session** and **Decline**. It SHALL name the agent as the chat's title together with its provider, for example "Pixel (Claude Code)". Deciding SHALL go through the server's approval decision path, with its authority check. Once the approval is decided or ends, the entry SHALL record the outcome on every client and SHALL offer no actions.

#### Scenario: Approve from a phone

- **WHEN** a chat's `run_command` call waits on approval and both the desktop and a phone show that chat
- **THEN** both show the approval, and tapping Allow One Time on the phone runs it once and records "Allowed once" on both

### Requirement: Provider availability and failures

The server SHALL list each registered chat provider with its display name and whether it is available. Where it is not, it SHALL give a reason: `not_installed`, `not_signed_in`, `unsupported_platform`, or `disabled` when its extension is disabled or quarantined. Creating a chat, or opening a new session, with an unavailable provider SHALL fail with that reason. A provider failure during a session SHALL end the turn and add a notice entry. The notice SHALL state the reason in plain words, and for `not_installed` and `not_signed_in` it SHALL name the command the user can run. When a provider session ends unexpectedly, the server SHALL revoke its capability and add a notice that the agent stopped. The next message SHALL start a new session, and the notice SHALL tell the user the new agent does not remember the earlier conversation.

#### Scenario: Codex not signed in

- **WHEN** a chat's provider is Codex and the server account has no Codex login
- **THEN** the turn ends with a notice saying Codex is not signed in and naming `codex login`

#### Scenario: Agent crashes

- **WHEN** a chat's agent process exits during a conversation
- **THEN** the chat shows a notice that the agent stopped, and the next message starts a fresh session and says it has no memory of earlier messages

#### Scenario: Extension disabled

- **WHEN** the extension providing a chat's provider is disabled
- **THEN** the chat's session ends with a notice, and the provider is listed as unavailable with reason `disabled`

### Requirement: Chat secrecy and diagnostics

A chat capability token SHALL never appear in a conversation, client message, log or diagnostic. Diagnostics SHALL record chat lifecycle events, such as session start, session end with its exit status, provider id and failure reason. They SHALL never record message text, tool arguments or tool results.

#### Scenario: Diagnostics after a crash

- **WHEN** a chat's agent exits unexpectedly and the user captures diagnostics
- **THEN** the diagnostics include the provider and exit, and no conversation text or token
