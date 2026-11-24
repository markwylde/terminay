## MODIFIED Requirements

### Requirement: Project-scoped MCP terminal control

Terminay SHALL provide a local Model Context Protocol server for Claude Code, Codex, Cursor CLI, Antigravity CLI, Grok, and OpenCode processes running inside Terminay terminals. An installed agent in a project terminal SHALL be able to inspect and control terminal tabs in its own project, and to rename, re-icon and recolour that project. It SHALL NOT be able to learn about or control other projects, workspace windows, servers or clients, or the server's settings. A process in a terminal of the automation terminal space SHALL instead hold the workspace scope defined for automation terminals. It SHALL NOT be able to learn about or control other servers, or any client except as the agent's client.

#### Scenario: Agent lists terminals

- **WHEN** an agent launched inside a project terminal lists terminals
- **THEN** it sees only terminal panels belonging to the calling terminal's canonical project

#### Scenario: Agent attempts cross-project control

- **WHEN** an agent in a project terminal attempts to address a terminal in another project or on another server
- **THEN** the request is refused

#### Scenario: Automation terminal lists terminals

- **WHEN** a process in an automation terminal lists terminals
- **THEN** it sees the terminal panels of every project and of the automation terminal space on its own server, and nothing on another server

### Requirement: MCP product outcomes

A user SHALL be able to install or remove the Terminay MCP registration for Claude Code, Codex, Cursor CLI, Antigravity CLI, Grok, and OpenCode independently. Once installed, an agent launched normally inside a Terminay terminal SHALL be able to use Terminay tools without copying a socket path or token. MCP SHALL remain usable when no renderer is attached and across renderer reloads.

#### Scenario: Agent uses tools without manual configuration

- **WHEN** an agent is launched normally inside a Terminay terminal with MCP installed
- **THEN** it can call Terminay tools without the user copying a socket path or token

#### Scenario: No renderer attached

- **WHEN** no renderer is attached or a renderer reloads
- **THEN** MCP operations remain usable

### Requirement: Registration management surface

Terminay SHALL expose an **Install Terminay MCP** action in Settings for the server a window shows, whether that server is Desktop's own or a standalone server. The targets SHALL be detected and installed on that server's machine, with that server's own MCP entry as the registered command. Its management surface SHALL list every MCP install target contributed by an enabled extension. The built-in agents extension contributes Claude Code, Codex, Cursor CLI, Antigravity CLI, Grok, and OpenCode. For each target the surface SHALL:

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

#### Scenario: Installing on a standalone server

- **WHEN** a window shows a standalone server and the user installs the Claude Code target
- **THEN** the registration is written into Claude Code's configuration on that server's machine, naming that server's own Node binary and MCP entry by absolute path, and nothing changes on the machine running the window

### Requirement: Isolated provider compatibility coverage

CI SHALL run a Docker-isolated compatibility test with the supported agent CLIs installed. The test SHALL give Terminay a container-only home directory. It SHALL register the packaged stdio command through the same extension install targets used by the application, and SHALL require each real CLI to load and report the `terminay` registration. It SHALL need no provider credentials, SHALL never use the host home directory, and SHALL fail when a client stops accepting Terminay's configuration contract.

#### Scenario: Client stops accepting the contract

- **WHEN** a supported agent CLI stops accepting Terminay's configuration contract
- **THEN** the Docker-isolated compatibility test fails

#### Scenario: No credentials required

- **WHEN** the compatibility test runs
- **THEN** it uses a container-only home directory and requires no provider credentials or host configuration access

#### Scenario: Antigravity CLI covered

- **WHEN** the compatibility test runs
- **THEN** it installs the current `agy` release, registers Terminay through the Antigravity CLI install target, and requires `agy mcp list` to exit successfully and report the `terminay` server as an enabled stdio server

#### Scenario: Antigravity MCP child inherits the terminal environment

- **WHEN** the compatibility test starts `agy` with a probe registered as its `terminay` server and a marker variable in agy's environment
- **THEN** the probe records that the marker reached it, without signing in and without recording the variable's value

## REMOVED Requirements

### Requirement: Per-client user-wide registration contracts

**Reason**: Gemini CLI is no longer a supported MCP client; Antigravity CLI replaces it.
**Migration**: The contracts carry over unchanged, with Antigravity CLI in place of Gemini CLI, under "User-wide registration contract for each client". A `terminay` entry already in `~/.gemini/settings.json` stays where it is; Terminay no longer reads or changes it.

## ADDED Requirements

### Requirement: User-wide registration contract for each client

Terminay SHALL register each client in its supported user-wide scope so the adapter is available to agents launched from any Terminay project. Claude Code SHALL use the `terminay` entry in `mcpServers` in `~/.claude.json`. Codex SHALL use the `[mcp_servers.terminay]` table in `~/.codex/config.toml`, including an `env_vars` whitelist for the inherited `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN` capability variables. Cursor CLI SHALL use the `terminay` entry in `mcpServers` in `~/.cursor/mcp.json`, shared with Cursor's user-level MCP configuration. Antigravity CLI SHALL use the `terminay` entry in `mcpServers` in its user-level MCP configuration `~/.gemini/config/mcp_config.json`, the file `agy mcp` manages, retaining Antigravity's normal tool permission policy and touching no other file under `~/.gemini/`. Grok SHALL use the `[mcp_servers.terminay]` table in `~/.grok/config.toml`, or `$GROK_HOME/config.toml` when that environment variable is set, without a Codex-style `env_vars` whitelist because Grok stdio MCP children inherit the terminal environment. OpenCode SHALL use the `terminay` local server in `mcp` in the active stable user configuration under `~/.config/opencode/`, using a command array and no trust or permission override.

#### Scenario: Codex registration

- **WHEN** Terminay registers with Codex
- **THEN** it writes the `[mcp_servers.terminay]` table in `~/.codex/config.toml` with an `env_vars` whitelist for `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN`

#### Scenario: Grok registration with GROK_HOME

- **WHEN** `$GROK_HOME` is set
- **THEN** Terminay writes the `[mcp_servers.terminay]` table in `$GROK_HOME/config.toml`

#### Scenario: OpenCode registration

- **WHEN** Terminay registers with OpenCode
- **THEN** it writes the `terminay` local server in `mcp` under `~/.config/opencode/` using a command array and no trust or permission override

#### Scenario: Antigravity registration

- **WHEN** Terminay registers with Antigravity CLI
- **THEN** it writes the `terminay` entry in `mcpServers` in `~/.gemini/config/mcp_config.json`, `agy mcp list` reports it enabled, and no other file under `~/.gemini/` is created or changed

#### Scenario: Antigravity permission policy

- **WHEN** an agy session started in a Terminay terminal calls a Terminay tool
- **THEN** agy applies its normal tool permission policy and Terminay's own MCP permission policy decides the operation
