## MODIFIED Requirements

### Requirement: MCP is independent of agent status observation

MCP terminal control and agent status SHALL be independent product capabilities, even when one extension contributes both a session source and MCP install targets. MCP SHALL register a Terminay stdio server with supported agent clients and give processes launched inside a Terminay terminal a project-scoped control capability. The Agents sidebar and terminal agent status SHALL come only from session sources. Observing any harness SHALL NOT register an MCP client. Installing, enabling, disabling, or removing Terminay MCP SHALL never install, edit, trust, invoke, or remove provider hooks.

#### Scenario: omp observed

- **WHEN** Terminay reports an oh-my-pi session for agent status
- **THEN** no MCP client is registered

#### Scenario: MCP installed

- **WHEN** Terminay MCP is installed, enabled, disabled, or removed
- **THEN** no provider hook configuration is installed, edited, trusted, invoked, or removed

#### Scenario: MCP does not affect agent discovery

- **WHEN** MCP registration state changes
- **THEN** how Terminay discovers or displays agents is unchanged

### Requirement: Registration management surface

Terminay SHALL expose an **Install Terminay MCP** action on Desktop. Its management surface SHALL list every MCP install target contributed by an enabled extension. The built-in agents extension contributes Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode. For each target the surface SHALL:

- show one of not installed, installed, changed, unavailable, or error
- identify the provider-owned configuration scope being changed
- install and remove that target independently

Server Core SHALL route every detection, install, and removal to the contributing extension with the host-supplied MCP server command. When no enabled extension contributes a target, the surface SHALL say that MCP install targets come from the built-in agents extension and that it is disabled or missing, and SHALL offer no install action.

#### Scenario: Registration state shown

- **WHEN** a user opens the MCP management surface
- **THEN** each contributed target shows one of not installed, installed, changed, unavailable, or error, together with the provider-owned configuration scope being changed

#### Scenario: Independent install

- **WHEN** a user installs the registration for one target
- **THEN** the other targets' registrations are unchanged

#### Scenario: Agents extension disabled

- **WHEN** the built-in agents extension is disabled and the user opens the MCP management surface
- **THEN** it explains that install targets come from that extension and offers no install action

### Requirement: Versioned provider registration adapters

Provider configuration formats and commands can change independently of Terminay. Provider-specific registration adapters SHALL live in the extension that contributes the install target, SHALL be versioned, and SHALL be tested against their current supported contracts. They SHALL share no parsing logic with session detection.

#### Scenario: Provider format changes

- **WHEN** a provider changes its MCP configuration contract
- **THEN** only that install target's adapter in the contributing extension changes, and session detection is unaffected

### Requirement: Isolated provider compatibility coverage

CI SHALL run a Docker-isolated compatibility test with the supported agent CLIs installed. The test SHALL give Terminay a container-only home directory. It SHALL register the packaged stdio command through the same extension install targets used by the application, and SHALL require each real CLI to load and report the `terminay` registration. It SHALL need no provider credentials, SHALL never use the host home directory, and SHALL fail when a client stops accepting Terminay's configuration contract.

#### Scenario: Client stops accepting the contract

- **WHEN** a supported agent CLI stops accepting Terminay's configuration contract
- **THEN** the Docker-isolated compatibility test fails

#### Scenario: No credentials required

- **WHEN** the compatibility test runs
- **THEN** it uses a container-only home directory and requires no provider credentials or host configuration access
