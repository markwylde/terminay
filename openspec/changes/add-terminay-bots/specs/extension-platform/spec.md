## MODIFIED Requirements

### Requirement: Agent bots permission

A bot agent SHALL require the `agent-bots` permission.

`agent-bots` SHALL authorize:

- registering the declared bot agents;
- answering the host's requests for models, status, and launch details;
- having the host run the declared device sign-in command inside a bot's container, as `bot`, when the user asks to sign that bot in;
- having the host inject the declared credential secrets into the agent processes of bots that use them.

It SHALL NOT grant:

- client authority;
- access to bots, sessions, transcripts, memories, or files;
- running anything in a bot's container;
- reading a credential secret's value.

#### Scenario: Missing permission

- **WHEN** a package declares a bot agent without `agent-bots`
- **THEN** manifest validation fails

### Requirement: Bot agent contribution

A package SHALL declare each bot agent under `contributes.botAgents`. Each declaration SHALL carry:

- a namespaced agent id and a display name;
- an **image install** step: npm package specifiers, each pinned to an exact version, and optionally Debian package names;
- the ACP command that runs the agent's Agent Client Protocol server on stdio, as an executable and its arguments;
- zero or one **device sign-in**, for an agent whose CLI can sign in without a browser on the machine it runs on. It has:
  - the sign-in command, as an executable and its arguments, which prints a URL and a one-time code and saves the login in the agent's own home;
  - the sign-out command, as an executable and its arguments, which removes that login;
  - optionally, its own bot config files, which the host writes in place of the agent's bot config files of the same path while the bot signs in this way, and before it runs the sign-in command;
  - a label and help text;
- zero or more **credential secrets**, each with:
  - an environment variable name;
  - a kind, which is sign-in token or API key;
  - whether the agent needs an ACP `authenticate` call, and with which method id, before it uses the secret;
  - a label;
  - help text that says how to obtain the value;
- whether the agent can ask permission inside a bot container. An agent that cannot is **Autonomous only**;
- zero or more **bot config files**: a path relative to `/home/bot` and its fixed contents, which the host writes into each bot's home when the bot is created and restores before each session;
- a fixed, non-secret **launch environment**.

Manifest validation SHALL reject:

- an install step of any other form;
- a version that is not exact;
- a path that is absolute or contains `..`;
- a bot config file inside `memories/` or a Terminay-reserved directory;
- a device sign-in without both a sign-in command and a sign-out command;
- a launch environment that names a declared credential secret;
- an environment variable name that does not match `[A-Z][A-Z0-9_]*`.

#### Scenario: Pinned packages

- **WHEN** a package declares a bot agent whose install step names `@agentclientprotocol/codex-acp@latest`
- **THEN** manifest validation fails, naming the unpinned specifier

#### Scenario: Bot config file escapes home

- **WHEN** a package declares a bot config file whose path is `../.ssh/config`
- **THEN** manifest validation fails

#### Scenario: Device sign-in without a sign-out command

- **WHEN** a package declares a device sign-in that has a sign-in command but no sign-out command
- **THEN** manifest validation fails

### Requirement: Bot agent registration and runtime

At activation, an extension SHALL register each declared bot agent with `context.agents.registerBotAgent(id, runtime)`, which SHALL return a disposable registration. Registration SHALL be refused for an undeclared id, for a duplicate id, and after deactivation.

The runtime SHALL implement:

- `models(signal)`: returns the agent's selectable models, at most 64, each with an id and a display name;
- `status(signal)`: returns ready, or not signed in with a bounded detail;
- `launch(request, signal)`: receives the chosen model id, or Default. It returns the extra ACP command arguments and the non-secret environment the adapter needs. The host uses these only for an agent that does not offer model selection through ACP session configuration.

The host SHALL validate and bound every result, and SHALL cache `models` per activation. A call that times out or throws SHALL leave the agent shown as unavailable. The extension SHALL NOT start, stop, or speak to the agent process.

#### Scenario: Models listed

- **WHEN** a user opens the model picker for a bot whose agent is Codex
- **THEN** the host asks the Codex bot agent for its models, and the picker lists Default plus those models

#### Scenario: Extension child crashed

- **WHEN** the extension contributing a bot's agent has crashed and is in backoff
- **THEN** the agent is shown as unavailable, and its bots start no new session until the extension is running again

### Requirement: The host runs bot agents over ACP

The host SHALL start each session's agent inside the bot's container, as the `bot` user, under the session launcher. It SHALL use the declared ACP command, and SHALL start it directly, never through a shell. The host SHALL be the ACP client:

- **Session setup.** It SHALL initialize the agent and open or load the session in `/home/bot`.
- **Model selection.** When the agent offers a model option in its session configuration, the host SHALL set the bot's model through that option. Otherwise it SHALL apply what `launch` returned.
- **Turns.** It SHALL send prompts and cancel turns.
- **Transcript.** It SHALL record session updates as the bot's transcript.
- **Sign-in.** For a credential secret that needs it, it SHALL call ACP `authenticate` with the declared method id before opening the session.
- **Permissions.** It SHALL answer permission requests as the bot's approval mode decides.
- **Client capabilities.** It SHALL advertise no file system or terminal capabilities, so the agent acts with its own tools inside the container.
- **Continue.** It SHALL offer Continue only for an agent that advertises session loading.

The extension SHALL have no part in the session.

#### Scenario: Agent runs in the container

- **WHEN** a bot whose agent is Claude Code starts a session
- **THEN** the agent process runs inside that bot's container as `bot`, and no agent process for that session runs on the server account

#### Scenario: Model rejected

- **WHEN** the agent rejects the bot's chosen model
- **THEN** the session fails, and the reason names the model

### Requirement: Scoped secret brokerage

Secret values SHALL live only in the Terminay Server vault. References SHALL be owned by `{extensionId, profileId, fieldId/purpose}`. An extension MUST NOT enumerate the vault or resolve another binding. Each time it resolves a secret, the broker SHALL recheck extension and profile ownership and operation permission. It SHALL send only the scoped transient copy over private IPC, and SHALL zeroize its server-side copy afterward.

UI, snapshots, events, audit, diagnostics, errors, manifests, argv, and environment variables SHALL contain metadata only, with one exception. The host MAY place a bot's credential secret in the environment of the local `docker` client process that starts that bot's agent, so that the agent receives it. Even then, the value SHALL NEVER appear in that client's arguments. No extension SHALL receive a bot's credential secret.

#### Scenario: Cross-extension secret resolution

- **WHEN** an extension requests a secret bound to another extension or profile
- **THEN** the request fails closed

#### Scenario: Secret exposure surfaces

- **WHEN** UI, snapshots, events, audit records, diagnostics, errors, manifests,
  argv, or environment variables are produced
- **THEN** they contain secret metadata only

#### Scenario: Bot credential injection

- **WHEN** the host starts a bot's agent with an API key
- **THEN** the key is in the `docker` client's environment, is absent from every process's arguments, and is never sent to the extension

### Requirement: Bounded API scope

The public API SHALL support session sources, MCP install targets, language servers, worktree insights, terminal launchers, terminal command defaults, chat providers, and bot agents. Themes, editor plugins, autocomplete sources, arbitrary commands, renderer components, and generic Server Core operation registration SHALL be out of scope.

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

#### Scenario: Terminal launcher contribution

- **WHEN** a package declares a terminal launcher contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Terminal command default contribution

- **WHEN** a package declares a terminal command default contribution
- **THEN** it is a supported contribution kind and validation accepts it

#### Scenario: Bot agent contribution

- **WHEN** a package declares a bot agent contribution
- **THEN** it is a supported contribution kind and validation accepts it

### Requirement: Contribution arrays

`contributes.agentSessionSources`, `contributes.mcpInstallTargets`, `contributes.languageServers`, `contributes.worktreeInsights`, `contributes.agentChatProviders`, `contributes.terminalLaunchers`, and `contributes.terminalCommandDefaults` SHALL be the supported contribution arrays, and at least one supported contribution SHALL be required.

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

#### Scenario: Launcher-only package

- **WHEN** a package contributes one or more terminal launchers that name no harness, and nothing else
- **THEN** it passes contribution validation

#### Scenario: Command-default-only package

- **WHEN** a package contributes one or more terminal command defaults that name no harness, and nothing else
- **THEN** it passes contribution validation

#### Scenario: Bot-agent-only package

- **WHEN** a package contributes one or more bot agents and nothing else
- **THEN** it passes contribution validation

### Requirement: Host-owned behaviours excluded from extension authorship

Terminay SHALL own all of the following, and the API SHALL offer an extension no means of implementing any of them:

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
- bots, bot containers and images, bot sessions and transcripts, the ACP client, credential sharing and injection, and bot UI
- extension process lifetime and crash backoff
- Electron-versus-standalone packaging

An extension SHALL supply only:

- session facts;
- MCP registration knowledge;
- the running of chat provider turns;
- the description of bot agents, which is their install step, ACP command, credentials, models, status, and launch details.

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

#### Scenario: Bot agent responsibilities

- **WHEN** a bot agent is authored
- **THEN** it describes the agent and answers models, status, and launch, and it cannot start the agent, read a transcript, or reach a bot's container
