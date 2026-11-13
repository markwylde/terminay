## ADDED Requirements

### Requirement: Pixel explains a missing agent

Whenever Pixel's balloon opens, the client SHALL ask the server which chat providers are available. When the Pixel provider is set and reports `not_installed`, the balloon SHALL say in plain words that Pixel is set up to use that agent and it is not installed, with a button that opens the agent's install guide. When another provider is available, the message SHALL also say Pixel can be switched to it in Settings > AI > Pixel. While the Pixel provider is unset and no provider is available, the balloon SHALL show a button to the install guide of each provider that reports `not_installed`, in place of that provider's detail text. The message SHALL be the client's own and SHALL NOT be added to the server's conversation.

#### Scenario: Chosen agent not installed

- **WHEN** Pixel's provider is Claude Code, `claude` is not installed, and the user opens Pixel
- **THEN** the balloon says Pixel is set up to use Claude Code and it is not installed, with an "Install Claude Code" button

#### Scenario: The other agent is available

- **WHEN** Pixel's provider is Claude Code, `claude` is not installed, and Codex is available
- **THEN** the balloon's message also says Pixel can be switched to Codex in Settings > AI > Pixel

#### Scenario: Neither agent installed during onboarding

- **WHEN** the Pixel provider is unset, neither `claude` nor `codex` is installed, and the user opens Pixel
- **THEN** the balloon says neither is installed and shows "Install Claude Code" and "Install Codex" buttons

#### Scenario: Agent installed later

- **WHEN** the user installs the missing agent while Terminay runs and opens Pixel again
- **THEN** the install message is gone and Pixel chats with that agent

### Requirement: Pixel's agent install guides

An install button in Pixel's balloon SHALL open the agent's official install guide through the host's external-link handling: the system browser in Desktop, a new browser tab elsewhere. The guides SHALL be:

| Agent | Install guide |
|---|---|
| Claude Code | `https://code.claude.com/docs/en/setup` |
| Codex | `https://learn.chatgpt.com/docs/codex/cli` |

#### Scenario: Opening the guide

- **WHEN** the user activates "Install Claude Code" in Pixel's balloon in Desktop
- **THEN** `https://code.claude.com/docs/en/setup` opens in the system browser
