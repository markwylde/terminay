# mcp-permissions Specification

## Purpose
Terminay lets the user decide, per kind of operation, what agents may do through the Terminay MCP server: each permission group is set to ask, always allow, or never allow, and an operation that asks waits on an inline prompt in the calling terminal that any authorized client can answer.

## Requirements

### Requirement: MCP permission groups

Every MCP operation other than `get_mcp_capabilities` SHALL belong to exactly one permission group, fixed in the server's operation table:

- **Read Terminals**: `list_terminals`, `read_terminal`, `search_terminal`, `get_terminal_status`, `wait_for_idle`, `wait_for_command`, and `wait_for_attention`.
- **Full Terminal Management**: `open_terminal`, `close_terminal`, `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, and `split_terminal`.
- **Read Automations**: `list_automations`, `get_automation`, and `list_automation_runs`.
- **Full Automation Management**: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, and `stop_automation_run`.

`get_mcp_capabilities` SHALL belong to no group and SHALL always be permitted after capability validation. An operation's group SHALL NEVER depend on its parameters, the caller, or its scope.

#### Scenario: Running a command

- **WHEN** an agent calls `run_command`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Running an automation now

- **WHEN** an agent calls `run_automation`
- **THEN** the server evaluates it under Full Automation Management

#### Scenario: Capability discovery

- **WHEN** every permission group is set to Never Allow and an agent calls `get_mcp_capabilities`
- **THEN** the call succeeds

### Requirement: MCP permission policy settings

Settings > AI > Terminay MCP SHALL list the four permission groups under the **Enable Terminay MCP server** switch, each with a choice of **Ask Permission**, **Always Allow**, or **Never Allow**. The defaults SHALL be Always Allow for Read Terminals, Full Terminal Management, and Read Automations, and Ask Permission for Full Automation Management. The policies SHALL be server-owned settings of the server that owns the MCP endpoint, SHALL be the same for every project and terminal on that server, and SHALL be shown and changed identically from desktop, web, and mobile clients.

#### Scenario: Fresh settings

- **WHEN** a server starts with no stored MCP permission settings
- **THEN** both terminal groups and Read Automations are Always Allow, and Full Automation Management is Ask Permission

#### Scenario: Changed from a browser client

- **WHEN** a user sets Full Terminal Management to Ask Permission from a browser client
- **THEN** the desktop client's settings show the same value and the next terminal-management call from any terminal on that server asks

### Requirement: Server-side permission enforcement

The server SHALL evaluate the permission policy after validating the capability and before dispatching an operation's handler, on every request. The evaluation SHALL use only the operation's group, the server's stored policy, and session grants held for the calling terminal's capability. It SHALL NEVER use UI focus, renderer state, terminal title, process name, cwd, or caller-supplied fields. An operation that is not permitted SHALL have no side effect.

#### Scenario: Always Allow

- **WHEN** an operation's group is Always Allow
- **THEN** the handler runs without a prompt

#### Scenario: Caller claims prior approval

- **WHEN** a request carries a parameter claiming it was already approved
- **THEN** the claim is ignored and the policy is evaluated normally

### Requirement: Never Allow refusal

An operation whose group is Never Allow SHALL be refused immediately with a stable `permission_denied` error. The error SHALL name the permission group and SHALL say that the user can change it in Settings > AI > Terminay MCP. It SHALL NOT show a prompt and SHALL NOT reveal anything about the target of the request.

#### Scenario: Automation reads denied

- **WHEN** Read Automations is Never Allow and an agent calls `list_automations`
- **THEN** it receives `permission_denied` naming Read Automations, and no prompt appears

### Requirement: Inline approval prompt

An operation whose group is Ask Permission, with no session grant covering it, SHALL create a pending approval on the server and wait for a decision. Each client that shows the calling terminal SHALL present the pending approval inline with that terminal's pane, above the terminal output, never as a modal, dialog, or separate window. This applies in the desktop, web, and mobile layouts. The prompt SHALL state:

- the agent, using the agent detected in the calling terminal where known and "An agent" otherwise;
- the calling terminal's display title;
- a plain-words summary of the requested action;
- the full details the operation would apply: for an automation, its name, trigger, action including the complete command or text, and settings; for an edit, which fields change.

The prompt SHALL offer **Allow One Time**, **Allow This Session**, and **Decline**. While the calling terminal is not visible, its tab SHALL show that it needs attention.

#### Scenario: Agent adds an automation

- **WHEN** Full Automation Management is Ask Permission and Claude in "Terminal 1" calls `create_automation` for "Email digest" with a schedule of every 10 seconds
- **THEN** Terminal 1's pane shows a prompt such as "Claude in Terminal 1 wants to add the automation 'Email digest', which runs every 10 seconds", with the full command, and the buttons Allow One Time, Allow This Session, and Decline

#### Scenario: Prompt on a phone

- **WHEN** a pending approval exists and a user views the calling terminal from a mobile browser
- **THEN** the prompt appears inside that terminal's view and can be answered there

#### Scenario: Calling terminal in a background tab

- **WHEN** a pending approval exists for a terminal whose tab is not selected
- **THEN** that tab shows that it needs attention, and selecting it shows the prompt

### Requirement: Approval decisions

Any client attached to the owning server with authority to create terminals on it SHALL be able to decide a pending approval. The first decision SHALL resolve it, and the prompt SHALL then disappear from every client. A decision from a client without that authority SHALL be refused. The outcomes SHALL be:

- **Allow One Time** runs the operation once.
- **Allow This Session** runs the operation and records a session grant.
- **Decline** refuses it with a stable `permission_declined` error.

A decision SHALL apply only to the pending approval it names.

#### Scenario: Two clients show the prompt

- **WHEN** the desktop and a phone both show the same pending approval and the user taps Allow One Time on the phone
- **THEN** the operation runs once and the prompt disappears from both clients

#### Scenario: Decline

- **WHEN** the user chooses Decline
- **THEN** the agent receives `permission_declined` and nothing changes

#### Scenario: Viewer without authority

- **WHEN** a client without terminal-create authority on the server tries to decide an approval
- **THEN** the decision is refused and the approval stays pending

### Requirement: Approval binds the exact request

An approval SHALL authorize only the exact operation and parameters that were shown in the prompt. The server SHALL retain the validated request from when the approval was created and SHALL execute that request, never a re-sent or altered one. The server SHALL revalidate the operation's targets when it executes. If a target changed or disappeared while the approval was pending, the operation SHALL fail with its ordinary error rather than act on the new state.

#### Scenario: Automation edited while pending

- **WHEN** an approval to update an automation is pending and a user edits that automation in Home before approving
- **THEN** the approved update fails with a conflict and does not overwrite the user's edit

### Requirement: Session grants

A session grant SHALL allow one permission group for one calling terminal's capability without further prompts. It SHALL end when that capability is revoked or replaced, which happens on terminal exit, a move to another project, leaving or entering the automation terminal space, MCP disablement, or server restart. A session grant SHALL NEVER be persisted, SHALL NEVER apply to another terminal, including a split or a terminal the caller opened, and SHALL NEVER override a Never Allow policy.

#### Scenario: Second call after Allow This Session

- **WHEN** the user chose Allow This Session for Full Automation Management from Terminal 1 and the same agent then calls `delete_automation`
- **THEN** it runs without a prompt

#### Scenario: Another terminal

- **WHEN** Terminal 1 holds a session grant and an agent in Terminal 2 calls `create_automation`
- **THEN** Terminal 2's pane shows a prompt

#### Scenario: Terminal exits

- **WHEN** Terminal 1 exits and a new terminal is opened in its place
- **THEN** the new terminal holds no session grant

### Requirement: Pending approval lifecycle

A pending approval SHALL have no time limit. It SHALL end only when:

- a user decides it;
- the MCP caller cancels the request or disconnects;
- the calling terminal's capability is revoked or replaced;
- MCP is disabled;
- the server restarts;
- the group's policy changes.

Every ending other than a decision SHALL refuse the operation without side effects and remove the prompt from every client. A policy change to Always Allow SHALL run the pending operation, and a change to Never Allow SHALL refuse it with `permission_denied`. Any change to a group's policy SHALL end all session grants for that group. Each calling terminal SHALL hold a bounded number of pending approvals, shown one at a time in request order. A request beyond the bound SHALL fail with a stable `approval_queue_full` error.

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
