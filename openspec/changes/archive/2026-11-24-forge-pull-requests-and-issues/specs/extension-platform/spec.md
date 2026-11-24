## ADDED Requirements

### Requirement: Forge source permission

A forge source SHALL declare the `forge-source` permission. The permission
SHALL authorize answering Terminay's forge account, claim, query, and detail
calls, receiving the forge settings Terminay applies to those calls, and
resolving credentials for its own origins through the scoped vault broker. It
MUST NOT grant client authority, workspace navigation, Git or terminal access,
or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** an extension registers a forge source without declaring
  `forge-source`
- **THEN** the registration is refused

#### Scenario: Credential of another extension

- **WHEN** a forge source resolves a credential bound to another extension's
  origin
- **THEN** the broker refuses it

## MODIFIED Requirements

### Requirement: Bounded API scope

The public API SHALL support session sources, MCP install targets, language servers, worktree insights, forge sources, terminal launchers, terminal command defaults, chat providers, and bot agents. Themes, editor plugins, autocomplete sources, arbitrary commands, renderer components, and generic Server Core operation registration SHALL be out of scope.

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

#### Scenario: Forge source contribution

- **WHEN** a package declares a forge source contribution
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

`contributes.agentSessionSources`, `contributes.mcpInstallTargets`, `contributes.languageServers`, `contributes.worktreeInsights`, `contributes.forgeSources`, `contributes.agentChatProviders`, `contributes.terminalLaunchers`, and `contributes.terminalCommandDefaults` SHALL be the supported contribution arrays, and at least one supported contribution SHALL be required.

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

#### Scenario: Forge-source-only package

- **WHEN** a package contributes one or more forge sources and nothing else
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

### Requirement: Terminal launcher contribution and registration

A package SHALL declare each terminal launcher under `contributes.terminalLaunchers`. Each declaration SHALL carry:

- a namespaced launcher id
- a display name
- an icon id from Terminay's icon allowlist
- supported platforms
- optionally, the harness it belongs to, named by the id of a session source the same package declares and a harness id that source declares
- optionally, `initialPrompt: "positional"`, declaring that the program accepts an initial prompt as its first positional argument

At activation the extension SHALL register each declared launcher through `context.terminals.registerLauncher(id, runtime)`, which SHALL return a disposable registration. Registration SHALL be refused for an undeclared id, a duplicate id, or a registration after deactivation. The runtime SHALL implement `resolve(signal)`, which returns either available with the absolute path of the executable to start, or unavailable with one of `not_installed` or `unsupported_platform` and a bounded detail.

The host SHALL list a launcher as available only while its extension is active, the launcher is registered, its platform is supported, its harness, when it names one, is switched on, and its last resolution reported available. The host SHALL NOT call `resolve` for a launcher whose harness is switched off. The host SHALL refuse an executable path that is not absolute, exceeds the path bound, or contains a control character, and SHALL treat that launcher as unavailable. The host SHALL bound how long `resolve` may run and SHALL treat a launcher whose resolution times out or fails as unavailable. A launcher SHALL NOT supply arguments, environment, input, or a working directory: what is started, and where, is decided by the host. Declaring `initialPrompt` SHALL only permit the host to pass a user-confirmed prompt; the launcher SHALL NOT supply or see it.

The icon allowlist SHALL include marks for the agents the built-in agents extension supports. An icon id outside the allowlist SHALL fail manifest validation.

#### Scenario: Registering a declared launcher

- **WHEN** an extension registers a terminal launcher id its manifest declared
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Undeclared launcher

- **WHEN** an extension registers a launcher id its manifest did not declare
- **THEN** the registration is refused

#### Scenario: Harness switched off

- **WHEN** a launcher names a harness and that harness is switched off
- **THEN** the launcher is not listed as available and its `resolve` is not called

#### Scenario: Relative executable

- **WHEN** a launcher's `resolve` reports the executable `claude` rather than an absolute path
- **THEN** the host lists the launcher as unavailable

#### Scenario: Unknown icon

- **WHEN** a launcher declaration names an icon id that is not on the allowlist
- **THEN** manifest validation fails

#### Scenario: Launcher declaring an initial prompt

- **WHEN** a launcher declaration carries `initialPrompt: "positional"`
- **THEN** manifest validation accepts it and the host offers the launcher where an initial prompt is used

#### Scenario: Unknown initial prompt style

- **WHEN** a launcher declaration carries `initialPrompt` with any value other than `positional`
- **THEN** manifest validation fails

#### Scenario: Extension disabled

- **WHEN** the extension that contributes a launcher is disabled
- **THEN** the launcher is no longer listed as available
