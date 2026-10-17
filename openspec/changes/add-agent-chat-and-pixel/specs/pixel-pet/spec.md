## ADDED Requirements

### Requirement: Pixel settings and onboarding

Pixel SHALL be configured by two server-scoped settings under Settings > AI > Pixel:

- an **Enable Pixel** switch, off by default;
- the Pixel provider, which is unset by default or one of the available chat providers.

When the user opens Pixel's chat and the provider is unset, Pixel SHALL ask which agent to use. It SHALL offer the available providers, Claude Code and Codex, as quick replies, and SHALL NOT start a chat until one is chosen. Choosing one SHALL save it as the server's Pixel provider.

#### Scenario: Fresh server

- **WHEN** a server starts with no saved Pixel settings
- **THEN** Enable Pixel is off and no client shows Pixel

#### Scenario: First click

- **WHEN** the user has turned on Enable Pixel and clicks Pixel for the first time on a server whose Pixel provider is unset
- **THEN** the balloon asks whether Pixel should use Claude Code or Codex, offering only the providers that are available

#### Scenario: Choosing a provider

- **WHEN** the user picks Codex in the onboarding balloon
- **THEN** the server's Pixel provider becomes Codex and every client stops asking

### Requirement: The Pixel chat

Pixel SHALL be one agent chat per server, with the reserved key `pixel`, the title "Pixel", the configured Pixel provider, and `workspace` reach. The server SHALL create it, and only the server SHALL decide its provider and reach. A client SHALL obtain it only through a Pixel operation, which is refused while Pixel is off or the provider is unset. No client SHALL create a chat with the reserved key through the generic chat operations. The Pixel chat SHALL otherwise behave exactly as any agent chat does. Changing the Pixel provider SHALL close the Pixel chat, so the next message starts one with the new provider.

#### Scenario: Pixel reaches every project

- **WHEN** the user asks Pixel "what's running across my projects?"
- **THEN** Pixel's agent lists the terminals of every project on the server through Terminay MCP and answers

#### Scenario: Reserved key

- **WHEN** a client tries to create a chat with the key `pixel` through the generic chat operations
- **THEN** the request is refused

#### Scenario: Changing provider

- **WHEN** Pixel has a conversation running on Claude Code and the user changes the Pixel provider to Codex
- **THEN** the Pixel chat closes on every client, and the next message starts a Codex chat

### Requirement: Pixel presence and docking

While Pixel is on, every workspace client attached to the server SHALL show Pixel, the CRT-terminal character from `@markwylde/pet`. This applies in the desktop, browser and phone layouts. While docked, Pixel SHALL appear as a small static Pixel icon in its dock:

- the status bar's Pixel slot when the status bar is shown;
- a small icon in the bottom-right corner of the workspace when the status bar is hidden.

Activating the dock SHALL bring the animated Pixel out onto the workspace with its chat balloon open. Closing the balloon, or leaving Pixel idle with the balloon closed for a short fixed period, SHALL send Pixel back into its dock. Pixel's on-screen position and balloon size SHALL be device-local presentation and SHALL NOT be shared between clients. Under reduced motion, Pixel SHALL play only its calm resting idle and appear without flight.

#### Scenario: Clicking Pixel in the status bar

- **WHEN** the user clicks the docked Pixel in the status bar
- **THEN** Pixel flies out of the status bar onto the workspace and its chat balloon opens

#### Scenario: Closing the chat

- **WHEN** Pixel is out with its balloon open and the user closes the balloon
- **THEN** Pixel returns to its dock

#### Scenario: Status bar hidden on a phone

- **WHEN** the workspace renders in the compact layout with the status bar hidden
- **THEN** Pixel docks as a small icon in the bottom-right corner of the workspace and activating it brings Pixel out

### Requirement: Pixel shows the shared conversation

Pixel's balloon SHALL show the Pixel chat's conversation as the server holds it, the same on every client. User and assistant entries SHALL be balloon messages, with activity notes as lines in the assistant message. Notice entries SHALL be Pixel messages. Approval entries SHALL be messages with Allow One Time, Allow This Session and Decline buttons, and pressing one SHALL decide that approval. Sending, Stop and Clear in the balloon SHALL act on the Pixel chat. Pixel SHALL play its thinking animation while the chat is `thinking`, and its talking animation while it is `streaming`. The balloon SHALL keep no conversation history in client storage.

#### Scenario: Approval buttons

- **WHEN** Pixel's `create_automation` call waits on approval
- **THEN** the balloon shows a Pixel message describing the automation with Allow One Time, Allow This Session and Decline buttons, and pressing Decline refuses it and the buttons disappear on every client

#### Scenario: Another client's question

- **WHEN** the user asks Pixel a question from the desktop while Pixel's balloon is open on a phone
- **THEN** the phone's balloon shows the question and the streaming reply

### Requirement: Dock reflects Pixel's state

While Pixel is docked, its dock SHALL show that Pixel is working while a turn runs, and SHALL show that Pixel needs attention while a Pixel approval is pending. Its accessible name SHALL say Pixel's state. When a Pixel approval becomes pending, a docked Pixel SHALL come out with its balloon open on clients where the workspace is visible.

#### Scenario: Approval while docked

- **WHEN** Pixel is docked and its MCP call needs approval
- **THEN** the dock shows that Pixel needs attention and Pixel comes out with the balloon open on the approval

### Requirement: Pixel can be turned off completely

Turning off **Enable Pixel** SHALL turn Pixel off completely for the server. While it is off:

- no client SHALL show Pixel, its dock, its balloon or its onboarding, and no client SHALL create a pet instance;
- the server SHALL hold no Pixel chat;
- every Pixel operation SHALL be refused.

Turning it off SHALL, at once, close the Pixel chat, which cancels any turn, ends its provider session, revokes its capability and ends its pending approvals and session grants. It SHALL remove Pixel from every attached client without a reload. Turning it back on SHALL restore the dock, with no conversation and the saved provider. The setting SHALL persist across server restarts.

#### Scenario: Turning Pixel off mid-reply

- **WHEN** Pixel is replying with an approval pending and the user turns off Enable Pixel
- **THEN** the reply is cancelled, the agent process exits, the approval ends with nothing run, and Pixel disappears from every client

#### Scenario: Off after restart

- **WHEN** Pixel is turned off and the server restarts
- **THEN** Pixel stays off and no client shows Pixel
