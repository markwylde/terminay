# mcp-permissions Specification

## Purpose
Terminay lets the user decide, per kind of operation, what agents may do through the Terminay MCP server: each permission group is set to ask, always allow, or never allow, and an operation that asks waits on an inline prompt in the calling terminal that any authorized client can answer.

## Requirements

### Requirement: MCP permission groups

Every MCP operation other than `get_mcp_capabilities` SHALL belong to exactly one permission group, fixed in the server's operation table:

- **Read Terminals**: `list_terminals`, `read_terminal`, `search_terminal`, `get_terminal_status`, `get_layout`, `wait_for_idle`, `wait_for_command`, `wait_for_attention`, `get_workflow`, `list_workflow_templates`, and `get_workflow_template`.
- **Full Terminal Management**: `open_terminal`, `close_terminal`, `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, `update_terminal`, `move_terminal_to_project`, `split_terminal`, `focus_tab`, `move_tab`, `resize_pane`, `arrange_tabs`, `focus_project`, `focus_home`, `select_folder`, `create_folder`, `rename_folder`, `delete_folder`, `reorder_folders`, `move_tab_to_folder`, `open_file`, `close_tab`, `list_macros`, `run_macro`, `cancel_macro`, `create_workflow`, and `update_workflow_step`.
- **Workflow Templates**: `create_workflow_template`, `update_workflow_template`, and `delete_workflow_template`.
- **Read Automations**: `list_automations`, `get_automation`, and `list_automation_runs`.
- **Full Automation Management**: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, `stop_automation_run`, `remove_automation_run`, `prune_automation_runs`, and `dismiss_missed_runs`.
- **Projects & Windows**: `list_projects`, `create_project`, `update_project`, `move_project`, `close_project`, `list_workspace_windows`, `open_workspace_window`, `rename_workspace_window`, and `close_workspace_window`.
- **Read Settings**: `get_settings` and `list_shell_profiles`.
- **Change Settings**: `update_settings`, `save_shell_profile`, `delete_shell_profile`, `reorder_shell_profiles`, and `set_default_shell_profile`.
- **App Windows**: `show_window`, `close_window`, and `list_windows`, and the opening of a window for a connected server's tool that declares a UI.
- **Notifications**: `send_notification`, `list_notifications`, and `dismiss_notification`.
- **Connected Server Tools**: every tool offered by a connected MCP server, whether called by the agent or by that server's own view.

`get_mcp_capabilities` SHALL belong to no group and SHALL always be permitted after capability validation. An operation's group SHALL NEVER depend on its parameters, the caller, or its scope. Whether the caller's reach may use an operation SHALL be decided separately from its group, and before the policy is evaluated, so that a call outside the caller's reach never asks. A call to a connected server's tool that declares a UI SHALL be evaluated under Connected Server Tools to run and, separately, under App Windows to show its view. Where App Windows does not permit it, the tool SHALL still run and no window SHALL open.

#### Scenario: Running a command

- **WHEN** an agent calls `run_command`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Running an automation now

- **WHEN** an agent calls `run_automation`
- **THEN** the server evaluates it under Full Automation Management

#### Scenario: Capability discovery

- **WHEN** every permission group is set to Never Allow and an agent calls `get_mcp_capabilities`
- **THEN** the call succeeds

#### Scenario: Showing a window

- **WHEN** an agent calls `show_window`
- **THEN** the server evaluates it under App Windows

#### Scenario: Calling a connected server's tool

- **WHEN** an agent calls `diagrams__draw`
- **THEN** the server evaluates it under Connected Server Tools

#### Scenario: Windows denied, tools allowed

- **WHEN** App Windows is Never Allow, Connected Server Tools is Always Allow, and an agent calls a connected tool that declares a UI
- **THEN** the tool runs and returns its result, and no window opens

#### Scenario: Reading the layout

- **WHEN** an agent calls `get_layout`
- **THEN** the server evaluates it under Read Terminals

#### Scenario: Arranging tabs

- **WHEN** an agent calls `arrange_tabs`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Sending a notification

- **WHEN** an agent calls `send_notification`
- **THEN** the server evaluates it under Notifications

#### Scenario: Renaming a project from either reach

- **WHEN** a project-reach agent and a workspace-reach agent each call `update_project`
- **THEN** the server evaluates both under Projects & Windows

#### Scenario: Out-of-reach call never asks

- **WHEN** Change Settings is Ask Permission and an agent in a project terminal calls `update_settings`
- **THEN** the call fails with `out_of_scope` and no approval prompt appears

#### Scenario: Reading a workflow

- **WHEN** an agent calls `get_workflow`
- **THEN** the server evaluates it under Read Terminals

#### Scenario: Reporting a workflow step

- **WHEN** an agent calls `update_workflow_step`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Reading a workflow template

- **WHEN** an agent calls `get_workflow_template`
- **THEN** the server evaluates it under Read Terminals

#### Scenario: Saving a workflow template

- **WHEN** an agent calls `create_workflow_template`
- **THEN** the server evaluates it under Workflow Templates

#### Scenario: Starting a workflow from a template

- **WHEN** an agent calls `create_workflow` with a `template_id`
- **THEN** the server evaluates it under Full Terminal Management only

### Requirement: MCP permission policy settings

Settings > AI > Terminay MCP SHALL list the eleven permission groups and the Window Messages policy under the **Enable Terminay MCP server** switch, each with a choice of **Ask Permission**, **Always Allow**, or **Never Allow**. The defaults SHALL be Ask Permission for Full Automation Management, Workflow Templates, and Change Settings, and Always Allow for every other group and for Window Messages. The policies SHALL be server-owned settings of the server that owns the MCP endpoint. They SHALL be the same for every project, terminal and chat on that server, and SHALL be shown and changed identically from desktop, web, and mobile clients. They SHALL be changeable only from Settings, never through MCP.

#### Scenario: Fresh settings

- **WHEN** a server starts with no stored MCP permission settings
- **THEN** both terminal groups, Read Automations, Projects & Windows, Read Settings, App Windows, Notifications, Connected Server Tools, and Window Messages are Always Allow, and Full Automation Management, Workflow Templates, and Change Settings are Ask Permission

#### Scenario: Changed from a browser client

- **WHEN** a user sets Full Terminal Management to Ask Permission from a browser client
- **THEN** the desktop client's settings show the same value and the next terminal-management call from any terminal on that server asks

#### Scenario: App Windows set to Ask Permission

- **WHEN** a user sets App Windows to Ask Permission and an agent calls `show_window`
- **THEN** the calling terminal's pane shows an approval prompt stating the window's title, and no window opens until the user allows it

#### Scenario: Notifications set to Ask Permission

- **WHEN** a user sets Notifications to Ask Permission and an agent calls `send_notification`
- **THEN** the calling terminal's pane shows an approval prompt stating the notification's title and body, and no notification is added until the user allows it

#### Scenario: Notifications set to Never Allow

- **WHEN** a user sets Notifications to Never Allow and an agent calls `send_notification`
- **THEN** the call is refused and no notification is added

#### Scenario: Changing a setting asks by default

- **WHEN** Pixel calls `update_settings` on a fresh server to set scrollback to 10000
- **THEN** the Pixel chat shows an approval naming the scrollback setting with its current and requested values, and nothing changes until a user allows it

#### Scenario: Creating a project does not ask by default

- **WHEN** a Home terminal's agent calls `create_project` on a fresh server
- **THEN** the project is created without an approval prompt

#### Scenario: Saving a template asks by default

- **WHEN** an agent in a project terminal calls `create_workflow_template` on a fresh server
- **THEN** the calling terminal's pane shows an approval prompt naming the template and its step titles, and no template is saved until a user allows it

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

### Requirement: Window Messages policy

A message that an app window sends for the conversation SHALL be evaluated on the server under a **Window Messages** policy before anything is written to the terminal. The policy SHALL be Ask Permission, Always Allow, or Never Allow, SHALL default to Always Allow, and SHALL be a server-owned setting listed with the MCP permission groups. Under Ask Permission the request SHALL create a pending approval shown inline in the owning terminal's pane, stating the window's title and the complete text to be typed, with Allow One Time, Allow This Session, and Decline; a session grant SHALL cover later messages from windows of that terminal. Under Never Allow the view SHALL receive a refusal and nothing SHALL be written.

#### Scenario: Default

- **WHEN** a server has no stored setting and a window sends a message
- **THEN** the message is typed into the owning terminal without a prompt

#### Scenario: Ask Permission

- **WHEN** Window Messages is Ask Permission and the window "Deploy configurator" in Terminal 1 sends "Deploy api to eu-west-1"
- **THEN** Terminal 1's pane shows a prompt naming the window and the full text, and nothing is typed until the user allows it

#### Scenario: Never Allow

- **WHEN** Window Messages is Never Allow and a window sends a message
- **THEN** the view receives a refusal and nothing is written to the terminal

### Requirement: Window message approvals name attachments

A window message that carries attachments SHALL be evaluated under the Window Messages policy once, as one message, before any attachment is uploaded. Under Ask Permission the pending approval SHALL state, with the window's title and the complete text, each attachment's offered name and size. Declining SHALL upload nothing and write nothing. Under Never Allow the view SHALL receive a refusal and nothing SHALL be uploaded or written.

#### Scenario: Ask Permission with a photo

- **WHEN** Window Messages is Ask Permission and a window in Terminal 1 sends "Here is the error" with `screenshot.png` of 2 MiB
- **THEN** Terminal 1's pane shows a prompt with the window's title, the full text, and `screenshot.png` with its size, and nothing is uploaded or typed until the user allows it

#### Scenario: Declined with attachments

- **WHEN** the user declines that prompt
- **THEN** no file is written to the scratch directory and nothing is typed into the terminal

#### Scenario: Never Allow with attachments

- **WHEN** Window Messages is Never Allow and a window sends a message with an attachment
- **THEN** the view receives a refusal, and nothing is uploaded or written
