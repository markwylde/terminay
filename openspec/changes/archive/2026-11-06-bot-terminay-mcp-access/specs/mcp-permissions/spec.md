## MODIFIED Requirements

### Requirement: Inline approval prompt

An operation whose group is Ask Permission, with no session grant covering it, SHALL create a pending approval on the server and wait for a decision, unless the calling capability is a bot execution's (see Bot execution callers do not prompt). When the calling capability is a terminal's, each client that shows the calling terminal SHALL present the pending approval inline with that terminal's pane, above the terminal output, never as a modal, dialog, or separate window. When the calling capability is a chat's, each client that shows that chat SHALL present it as an approval entry in the chat. This applies in the desktop, web, and mobile layouts. The prompt SHALL state:

- the agent: for a terminal caller, the agent detected in the calling terminal where known and "An agent" otherwise; for a chat, the chat's title with its provider;
- for a terminal caller, the calling terminal's display title;
- a plain-words summary of the requested action;
- the full details the operation would apply: for an automation, its name, trigger, action including the complete command or text, and settings; for an edit, which fields change; for a terminal write or command, the target terminal's display title and the complete text.

The prompt SHALL offer **Allow One Time**, **Allow This Session**, and **Decline**. While a calling terminal is not visible, its tab SHALL show that it needs attention. A chat SHALL show that it needs attention wherever a client lists it.

#### Scenario: Agent adds an automation

- **WHEN** Full Automation Management is Ask Permission and Claude in "Terminal 1" calls `create_automation` for "Email digest" with a schedule of every 10 seconds
- **THEN** Terminal 1's pane shows a prompt such as "Claude in Terminal 1 wants to add the automation 'Email digest', which runs every 10 seconds", with the full command, and the buttons Allow One Time, Allow This Session, and Decline

#### Scenario: Prompt on a phone

- **WHEN** a pending approval exists and a user views the calling terminal from a mobile browser
- **THEN** the prompt appears inside that terminal's view and can be answered there

#### Scenario: Calling terminal in a background tab

- **WHEN** a pending approval exists for a terminal whose tab is not selected
- **THEN** that tab shows that it needs attention, and selecting it shows the prompt

#### Scenario: A chat runs a command

- **WHEN** Full Terminal Management is Ask Permission and the chat "Pixel" on Claude Code calls `run_command` with `npm test` in the terminal titled "api"
- **THEN** the chat shows a prompt such as "Pixel (Claude Code) wants to run `npm test` in api" with the buttons Allow One Time, Allow This Session, and Decline, and no terminal pane shows a prompt

## ADDED Requirements

### Requirement: Bot execution callers do not prompt

Turning on a bot's Terminay MCP access SHALL be the user's standing approval for that bot. For a bot execution caller, an operation whose group is Ask Permission SHALL run as though it were Always Allow, with no pending approval, prompt or notification. Never Allow SHALL refuse it with `permission_denied`. A bot execution caller SHALL hold no session grants and no pending approvals. Each call SHALL read the group's current policy. The bot's own approval mode SHALL NOT affect this.

#### Scenario: Ask Permission group from a bot

- **WHEN** Full Terminal Management is Ask Permission and a bot execution with Terminay MCP access calls `run_command` with `npm test` in the terminal titled "api"
- **THEN** the command runs at once, and no client shows an approval prompt

#### Scenario: Never Allow group from a bot

- **WHEN** Full Automation Management is Never Allow and a bot execution with Terminay MCP access calls `create_automation`
- **THEN** it receives `permission_denied` and nothing changes

#### Scenario: Policy changes during an execution

- **WHEN** a bot execution has run `run_command` and the user then sets Full Terminal Management to Never Allow
- **THEN** that execution's next `run_command` receives `permission_denied`

#### Scenario: Ask me bot

- **WHEN** a bot whose approval mode is Ask me, with Terminay MCP access, calls `create_project` while Change Projects is Ask Permission
- **THEN** Terminay creates no MCP approval, and any prompt shown comes only from the agent's own permission request
