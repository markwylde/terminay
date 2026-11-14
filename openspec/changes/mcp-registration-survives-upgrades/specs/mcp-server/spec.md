## MODIFIED Requirements

### Requirement: Registration management surface

Terminay SHALL expose an **Install Terminay MCP** action in Settings for the server a window shows, whether that server is Desktop's own or a standalone server. The targets SHALL be detected and installed on that server's machine, with that server's own MCP entry as the registered command. Its management surface SHALL list every MCP install target contributed by an enabled extension. The built-in agents extension contributes Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode. For each target the surface SHALL:

- show one of not installed, installed, changed, unavailable, or error
- identify the provider-owned configuration scope being changed
- install and remove that target independently
- offer **Replace** when the target is changed, which writes the server's entry over the existing `terminay` entry

Server Core SHALL route every detection, install, replacement, and removal to the contributing extension with the host-supplied MCP server command. When no enabled extension contributes a target, the surface SHALL say that MCP install targets come from the built-in agents extension and that it is disabled or missing, and SHALL offer no install action.

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

#### Scenario: Replacing a changed entry

- **WHEN** a target shows changed and the user chooses Replace
- **THEN** the target's `terminay` entry becomes exactly the server's entry, the target shows installed, and the rest of that provider configuration is unchanged

### Requirement: Terminay-owned registration entry

Registration SHALL use the provider's supported MCP configuration contract or CLI. Terminay SHALL create only its own named `terminay` stdio-server entry containing the stable command and arguments needed to start the packaged Terminay MCP adapter. The entry SHALL contain no terminal capability token, socket path, provider secret, project path, or hook configuration.

A standalone server that runs from a release directory `<prefix>/versions/<release>/` of an installation whose `<prefix>/current` pointer resolves to that release directory SHALL name its Node binary and MCP entry through `<prefix>/current`, so the registered command starts whichever release the installation has made current. A server not running from such an installation SHALL name the absolute paths it runs from.

#### Scenario: Entry written

- **WHEN** Terminay writes its registration entry
- **THEN** the entry is named `terminay`, carries the stable command and arguments for the packaged adapter, and contains no token, socket path, provider secret, project path, or hook configuration

#### Scenario: Standalone installation registers its stable pointer

- **WHEN** a standalone server installed under `/opt/terminay` runs from `/opt/terminay/versions/<release>/` and the user installs a target
- **THEN** the entry's command is `/opt/terminay/current/bin/node` and its argument is `/opt/terminay/current/server/dist/mcpEntry.js`

#### Scenario: Registration survives an upgrade

- **WHEN** a standalone server whose registration is installed is upgraded, and later upgraded again so the release it ran from is removed
- **THEN** the target still shows installed and the registered command starts the current release's MCP adapter

#### Scenario: Server outside an installation

- **WHEN** a server runs from a directory that is not a release directory of an installation, as Desktop and a development checkout do
- **THEN** the entry names the absolute paths of the executable and MCP entry the server runs from

### Requirement: Installation safety

Unrelated provider configuration SHALL be preserved and removal SHALL delete only the Terminay-owned MCP entry. A matching entry SHALL be treated as already installed. An existing but changed `terminay` entry SHALL be shown for review and SHALL NOT be overwritten silently; it SHALL be overwritten only by an explicit Replace. Writes SHALL be atomic when Terminay writes configuration directly. Provider configuration parse or validation failures SHALL never cause a destructive rewrite. Diagnostics SHALL redact secrets and SHALL NOT include unrelated provider configuration. Registration SHALL NOT grant blanket tool approval or alter the provider's normal MCP trust and approval policy. No install, uninstall, replace, detection, or repair path SHALL read or write provider hook configuration.

#### Scenario: Existing changed entry

- **WHEN** a `terminay` entry exists but differs from what Terminay would write
- **THEN** it is shown for review and is not overwritten by install, uninstall, detection, or server startup

#### Scenario: Matching entry

- **WHEN** the existing `terminay` entry matches
- **THEN** the registration is treated as already installed

#### Scenario: Unparsable provider configuration

- **WHEN** a provider configuration file fails to parse or validate
- **THEN** no destructive rewrite occurs, including on Replace

#### Scenario: Removal

- **WHEN** a user removes the Terminay registration
- **THEN** only the Terminay-owned MCP entry is deleted and unrelated provider configuration is preserved

#### Scenario: Trust policy

- **WHEN** the registration is installed
- **THEN** the provider's normal MCP trust and approval policy is unchanged and no blanket tool approval is granted
