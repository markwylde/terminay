## MODIFIED Requirements

### Requirement: Inline approval prompt

An operation whose group is Ask Permission, with no session grant covering it, SHALL create a pending approval on the server and wait for a decision. When the calling capability is a terminal's, each client that shows the calling terminal SHALL present the pending approval inline with that terminal's pane, above the terminal output, never as a modal, dialog, or separate window. When the calling capability is a chat's, each client that shows that chat SHALL present it as an approval entry in the chat. This applies in the desktop, web, and mobile layouts. The prompt SHALL state:

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

### Requirement: Session grants

A session grant SHALL allow one permission group for one calling capability without further prompts. For a terminal, it SHALL end when that terminal's capability is revoked or replaced, which happens on terminal exit, a move to another project, leaving or entering the automation terminal space, MCP disablement, or server restart. For a chat, it SHALL end when the chat's capability is revoked, which happens when its provider session ends, the chat is cleared or closed, MCP is disabled, or the server restarts. A session grant SHALL NEVER be persisted. It SHALL NEVER apply to another capability: a terminal's grant does not apply to a split, to a terminal the caller opened, or to a chat, and a chat's grant does not apply to any terminal or other chat. A session grant SHALL NEVER override a Never Allow policy.

#### Scenario: Second call after Allow This Session

- **WHEN** the user chose Allow This Session for Full Automation Management from Terminal 1 and the same agent then calls `delete_automation`
- **THEN** it runs without a prompt

#### Scenario: Another terminal

- **WHEN** Terminal 1 holds a session grant and an agent in Terminal 2 calls `create_automation`
- **THEN** Terminal 2's pane shows a prompt

#### Scenario: Terminal exits

- **WHEN** Terminal 1 exits and a new terminal is opened in its place
- **THEN** the new terminal holds no session grant

#### Scenario: Chat cleared

- **WHEN** the user chose Allow This Session for Full Terminal Management in a chat and then clears that chat
- **THEN** the chat's next `run_command` shows a prompt again

### Requirement: Pending approval lifecycle

A pending approval SHALL have no time limit. It SHALL end only when:

- a user decides it;
- the MCP caller cancels the request or disconnects;
- the calling capability is revoked or replaced;
- MCP is disabled;
- the server restarts;
- the group's policy changes.

Every ending other than a decision SHALL refuse the operation without side effects and remove the prompt from every client. A policy change to Always Allow SHALL run the pending operation, and a change to Never Allow SHALL refuse it with `permission_denied`. Any change to a group's policy SHALL end all session grants for that group. Each calling capability SHALL hold a bounded number of pending approvals, shown one at a time in request order. A request beyond the bound SHALL fail with a stable `approval_queue_full` error.

#### Scenario: Agent process killed

- **WHEN** an approval is pending and the agent process is interrupted so its MCP request is cancelled
- **THEN** the prompt disappears and nothing runs

#### Scenario: Left unanswered overnight

- **WHEN** an approval is pending and nobody answers it for hours while the terminal stays open
- **THEN** it is still pending and answerable

#### Scenario: Policy switched to Never Allow while pending

- **WHEN** an approval for Full Automation Management is pending and the user sets that group to Never Allow
- **THEN** the request fails with `permission_denied` and the prompt disappears

#### Scenario: Several requests at once

- **WHEN** an agent issues three automation-management calls concurrently from one terminal
- **THEN** the pane shows one prompt at a time, in request order

#### Scenario: User stops a chat while an approval is pending

- **WHEN** a chat's approval is pending and the user presses Stop in that chat
- **THEN** the turn is cancelled, the MCP request is cancelled, the approval actions disappear from every client, and nothing runs
