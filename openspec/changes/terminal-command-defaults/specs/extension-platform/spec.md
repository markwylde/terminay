## ADDED Requirements

### Requirement: Terminal command defaults permission

A terminal command default SHALL require the `terminal-command-defaults` permission. `terminal-command-defaults` SHALL authorize registering the declared command defaults and reporting, for each, whether it applies and which arguments it adds. It SHALL NOT grant client authority, terminal input or output, the ability to create, read, or write a terminal, shell code, environment, or working directory, or direct canonical-store mutation.

#### Scenario: Missing permission

- **WHEN** a package declares a terminal command default without `terminal-command-defaults`
- **THEN** manifest validation fails

### Requirement: Terminal command default contribution and registration

A package SHALL declare each terminal command default under `contributes.terminalCommandDefaults`. Each declaration SHALL carry a namespaced id, the command name it applies to, and optionally the harness it belongs to, named by the id of a session source the same package declares and a harness id that source declares. The command name SHALL be fixed by the manifest and SHALL meet the command-name rules of the terminal command defaults registry.

At activation the extension SHALL register each declared command default through `context.terminals.registerCommandDefault(id, runtime)`, which SHALL return a disposable registration. Registration SHALL be refused for an undeclared id, a duplicate id, or a registration after deactivation. The runtime SHALL implement `resolve(signal)`, which returns either applies with the arguments to place before the user's arguments, or does not apply with a bounded reason.

The host SHALL include a command default in the registry only while its extension is active, it is registered, its harness, when it names one, is switched on, and its last resolution reported that it applies with arguments that meet the registry's argument rules. The host SHALL NOT call `resolve` for a command default whose harness is switched off. The host SHALL resolve on registration and whenever the harness is switched on, SHALL bound how long `resolve` may run, and SHALL treat a timeout or failure as does not apply. The host SHALL NOT wait for resolution while launching a terminal; a launch uses the registry as it stands.

#### Scenario: Registering a declared command default

- **WHEN** an extension registers a command default id its manifest declared
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Harness switched off

- **WHEN** a command default names a harness and that harness is switched off
- **THEN** it is not in the registry and its `resolve` is not called

#### Scenario: Resolution reports an argument that is not a flag

- **WHEN** a command default's `resolve` returns the argument `exec`
- **THEN** the host treats it as does not apply

#### Scenario: Extension disabled

- **WHEN** the extension that contributes a command default is disabled
- **THEN** the command default leaves the registry and new terminals no longer receive it

## MODIFIED Requirements

### Requirement: Bounded API scope

The public API SHALL support session sources, MCP install targets, language servers, worktree insights, chat providers, terminal launchers, and terminal command defaults. Themes, editor plugins, autocomplete sources, arbitrary commands, renderer components, and generic Server Core operation registration SHALL be out of scope.

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
