## MODIFIED Requirements

### Requirement: Communication UI
Chat SHALL show the bot's shared message log with paginated history, explicit pending/failure states, message controls and inline durable attachments. Each message SHALL show its own author avatar, author name and the time it was posted, so consecutive messages from one author remain distinct. Session selection SHALL open execution details without changing chat history. Raw thoughts, provider output and provider-reported tool use SHALL remain in execution details; the only tool use Chat shows is the action entries the server records (see Terminay actions in the message log). New chat and conversation continuation SHALL not define ordinary messaging behavior. Schedules and events SHALL start fresh executions with the same runtime tools and communication log.

Each device SHALL remember, per bot, the last message it has read. When Chat opens with bot messages posted after that point, a labelled divider SHALL mark where they begin, and SHALL stay in place for the rest of that visit. Leaving Chat, closing or leaving the bot tab, hiding the window, or sending a message SHALL mark every loaded message read. A bot this device has never shown SHALL start with every message read.

The composer SHALL offer an attach button that opens a picker for files of any type. Files dropped onto the composer, and files pasted into it, SHALL be added the same way. The composer SHALL classify each file by its content, never by its claimed type or name. Each pending file SHALL show before sending with a remove control: PNG, JPEG, GIF or WebP content as a thumbnail, and any other file as a chip with a file icon, its name and its size. Send SHALL be enabled when the draft has text or at least one pending file. The composer SHALL refuse a fifth file, an image over 2 MiB or any other file over 5 MiB with an inline message, and leave the other pending files unchanged. Pending files SHALL be cleared once the message is posted and kept if posting fails. When the outcome of a send is unknown, a retry SHALL reuse the same idempotency key and any tokens already obtained, so the message is not duplicated. User messages SHALL show their image attachments inline, the same way bot posts do, and every other attachment as a file chip with its name and size. Activating a file chip SHALL save the attachment's bytes through the host's save flow; a non-image attachment SHALL never be rendered or opened in the workspace.

#### Scenario: Read execution details
- **WHEN** a user selects a recent execution
- **THEN** its diagnostics open separately and the shared chat log remains intact

#### Scenario: Provider tool use stays in details
- **WHEN** an execution runs a shell command through its provider's own shell tool
- **THEN** Chat shows no row for it, and the call appears in that execution's details

#### Scenario: Consecutive bot messages
- **WHEN** a bot posts three messages in a row
- **THEN** Chat shows three messages, each with the bot's avatar, its name and its own posting time

#### Scenario: Unread divider
- **WHEN** a bot posts two messages while the user is on another screen, and the user then opens Chat
- **THEN** a divider labelled with the count of new messages appears directly above the first of them

#### Scenario: Read on leave
- **WHEN** the user opens Chat with unread messages, then switches to Configure and back to Chat
- **THEN** no divider is shown

#### Scenario: Long unread run
- **WHEN** Chat opens with unread messages taller than the message viewport
- **THEN** the viewport starts with the divider near its top rather than at the bottom

#### Scenario: Enter Chat with delayed images
- **WHEN** Chat becomes visible with no unread messages and message images load after the initial history render
- **THEN** the message viewport starts at the bottom and stays there as the content grows, without scroll animation
- **AND** manually scrolling up suspends automatic following until the user returns to the bottom or re-enters Chat
- **AND** browser layout/anchoring scroll events do not count as manual history scrolling
- **AND** the existing Sessions labels are retained

#### Scenario: Attach with the button
- **WHEN** the user clicks the attach button and chooses an image
- **THEN** a thumbnail of the image appears in the composer with a remove control

#### Scenario: Attach a zip
- **WHEN** the user clicks the attach button and chooses `logs.zip`
- **THEN** a chip with a file icon, `logs.zip` and its size appears in the composer with a remove control

#### Scenario: Misleading type
- **WHEN** the user attaches a 3 MiB zip named `x.png` whose claimed type is `image/png`, and a PNG whose claimed type is empty
- **THEN** the zip is accepted and shown as a file chip, and the PNG is shown as a thumbnail under the 2 MiB image limit

#### Scenario: Drop and paste
- **WHEN** the user drops a file onto the composer or pastes a file from the clipboard
- **THEN** the file is added to the pending files, an image as a thumbnail and any other file as a chip
- **AND** pasting plain text still inserts the text into the draft

#### Scenario: Remove before sending
- **WHEN** the user removes a pending thumbnail or file chip
- **THEN** that file is not sent with the message

#### Scenario: Send image only
- **WHEN** the draft is empty and one image is pending and the user presses Enter
- **THEN** a user message with that image and no text appears in the chat log
- **AND** the composer clears its pending files

#### Scenario: Send a file
- **WHEN** the user sends a message with `logs.zip` pending
- **THEN** the user message shows a chip with `logs.zip` and its size
- **AND** activating the chip saves the archive's exact bytes through the host's save flow

#### Scenario: Active content is only downloaded
- **WHEN** a user message carries an HTML or SVG file
- **THEN** it shows as a file chip, and activating the chip saves it without rendering or opening it in the workspace

#### Scenario: Download fails
- **WHEN** reading a file attachment fails while the user activates its chip
- **THEN** the chip shows the error and the chat stays usable

#### Scenario: Too many or invalid files
- **WHEN** four files are pending and the user adds another, or adds an image over 2 MiB or another file over 5 MiB
- **THEN** the composer shows an inline message and leaves the pending files unchanged

#### Scenario: Send fails
- **WHEN** an upload or the post is refused
- **THEN** the composer shows the error and keeps the draft text and pending files

## ADDED Requirements

### Requirement: Terminay actions in the message log
When a live execution of a bot makes a recorded Terminay call, the server SHALL record one action entry in that bot's message log once the tool's handler has finished, whether the call succeeded or failed. The recorded calls SHALL be exactly these, and no others:

- terminals: `open_terminal`, `split_terminal`, `write_terminal`, `run_command`, `close_terminal`, `focus_terminal`, `rename_terminal`, `update_terminal`, `move_terminal_to_project`, `run_macro`, `cancel_macro`;
- tabs, folders and files: `focus_tab`, `move_tab`, `resize_pane`, `arrange_tabs`, `close_tab`, `focus_home`, `select_folder`, `create_folder`, `rename_folder`, `delete_folder`, `reorder_folders`, `move_tab_to_folder`, `open_file`;
- projects and windows: `create_project`, `update_project`, `move_project`, `close_project`, `focus_project`, `open_workspace_window`, `rename_workspace_window`, `close_workspace_window`;
- workflows: `create_workflow`, `update_workflow_step`, `create_workflow_template`, `update_workflow_template`, `delete_workflow_template`;
- automations: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, `stop_automation_run`, `remove_automation_run`, `prune_automation_runs`, `dismiss_missed_runs`;
- settings: `update_settings`, `save_shell_profile`, `delete_shell_profile`, `reorder_shell_profiles`, `set_default_shell_profile`;
- the bot's runtime trigger tools `triggers_create`, `triggers_update`, `triggers_delete`, `triggers_enable` and `triggers_run`.

A call refused before its operation is dispatched, because the capability is invalid, revoked or names no execution of that bot, SHALL NOT be recorded. An action whose message log was cleared while the call ran SHALL NOT be recorded.

#### Scenario: Bot creates a project
- **WHEN** an execution of a bot with Terminay MCP access calls `create_project` named "api" and it succeeds
- **THEN** the bot's log gains one action entry reading Created the project “api”, with outcome done and the new project as its link target

#### Scenario: Read calls are not recorded
- **WHEN** an execution calls `list_terminals`, `read_terminal`, `get_workflow` and `wait_for_idle`
- **THEN** the bot's log gains no entry

#### Scenario: Failed call
- **WHEN** an execution calls `create_automation` while Full Automation Management is Never Allow
- **THEN** the bot's log gains one action entry with outcome failed and a reason naming the permission refusal

#### Scenario: Bot creates a trigger
- **WHEN** an execution creates a trigger through its runtime trigger tools
- **THEN** the bot's log gains one action entry with that trigger as its link target

#### Scenario: Revoked capability
- **WHEN** a bot's Terminay MCP access is turned off and its running execution's next Terminay MCP call fails as revoked
- **THEN** the bot's log gains no entry for that call

#### Scenario: Chat cleared during a call
- **WHEN** the user clears a bot's chat while one of its `run_command` calls is still running
- **THEN** the cleared log gains no entry for that call

### Requirement: Action entry content
An action entry SHALL be authored by the bot, linked to its execution, and SHALL carry the tool's name, a description in Terminay's own words, its outcome, a failure reason for a failed call, a count, and a link target when the call created or addressed one. The description SHALL be in the past tense when the call was done and SHALL start "Couldn't" when it failed. The description and reason SHALL be redacted like the bot's own posts before they are cut and stored; when redaction fails, nothing SHALL be recorded. The description SHALL be at most 512 bytes and SHALL name terminals and projects by their display names. It SHALL quote only what the agent asked for, cut to 80 characters for a command and 60 for a name, and SHALL NEVER contain terminal output, setting values, file contents or a tool's result. The reason SHALL be at most 200 bytes, taken from the error code and message the tool returned.

#### Scenario: Run command describes the command, not its output
- **WHEN** an execution calls `run_command` with `npm test` in the terminal titled "api"
- **THEN** the action entry reads Ran `npm test` in the terminal “api”, links to that terminal, and contains none of the command's output

#### Scenario: Secret in a command
- **WHEN** an execution runs a command containing a value Terminay injected into the bot as a secret
- **THEN** the action entry shows that value redacted

### Requirement: Action link targets
A link target SHALL name a project, a terminal with its project, a terminal's workflow, an automation, a workflow template, one of the bot's own triggers, or Settings, by server ID. The server SHALL resolve it from the terminal or project the call addressed and from the call's result, never from the bot's text. A terminal target SHALL name the terminal by its session and by the project it is in once the call has finished. A call that closed or deleted its target, or that failed without addressing an existing one, SHALL carry no link target.

#### Scenario: Moved terminal
- **WHEN** an execution moves the terminal titled "api" to the project "web"
- **THEN** the action entry links to that terminal in "web"

#### Scenario: Failed trigger change names an unknown trigger
- **WHEN** an execution's `triggers_update` fails because the trigger ID it gave is not one of the bot's triggers
- **THEN** the failed action entry has no link target

### Requirement: Folding repeated actions
When the newest entry of the log is an action entry from the same execution with the same tool, description, outcome, reason and link target, the server SHALL fold the new action into it, increasing its count and revision, instead of adding an entry. The folded entry SHALL keep its place in the log.

#### Scenario: Repeated typing folds
- **WHEN** an execution calls `write_terminal` five times in a row on the terminal titled "api" and each call succeeds
- **THEN** the log holds one action entry for it with a count of five

#### Scenario: Different commands do not fold
- **WHEN** an execution runs `npm test` and then `npm run build` in the same terminal
- **THEN** the log holds two action entries

### Requirement: Action entry storage
Recording SHALL NOT delay or change the result of the call it records, and a failure to record SHALL NOT fail the call. A bot's log SHALL hold at most 2,000 action entries; recording one beyond that SHALL remove the oldest action entries, and never a message. Action entries SHALL NOT count against the history limit that refuses new messages.

#### Scenario: Busy bot
- **WHEN** a bot whose log holds 2,000 action entries and 50 messages records another action
- **THEN** its oldest action entry is removed, every message remains, and the user can still post

### Requirement: Action entries are not posts
An action entry SHALL NOT raise or change a bot notification, SHALL NOT count as an unacknowledged post or an unread message, and SHALL NOT start an execution. It SHALL be refused by message edit and delete, and SHALL be removed by Clear chat. Execution briefings SHALL leave action entries out of their recent message excerpts and message counts. Runtime message list, search and get SHALL return action entries marked as actions, with their description as text. A client SHALL NOT show an entry whose action data is malformed.

#### Scenario: No notification
- **WHEN** a bot whose posts are all acknowledged records three action entries and posts nothing
- **THEN** no bot notification is raised and Chat shows no unread divider when opened

#### Scenario: Pending notification unchanged
- **WHEN** a bot has one unacknowledged post with a notification and then records two action entries
- **THEN** the notification still counts one post and shows that post

#### Scenario: Edit refused
- **WHEN** a client asks to edit or delete an action entry
- **THEN** the request is refused and the entry is unchanged

#### Scenario: Clear chat
- **WHEN** the user clears a bot's chat
- **THEN** its action entries are removed with its messages

### Requirement: Action rows in Chat
Chat SHALL show each action entry at its place in the log as one compact row, without an avatar or author header, aligned with message text and set in smaller, muted type than a message. A row SHALL show an icon for its link target's kind, the description, a done or failed mark, a ×N count when it holds more than one action, and the time on hover. A failed row SHALL show its reason. A row SHALL offer no message menu.

Consecutive action rows SHALL be shown as one tight group. A group of more than three rows SHALL show its latest three and a control naming how many earlier actions are hidden, which shows them all. A group the user expanded SHALL stay expanded as rows arrive or fold into it. The unread divider SHALL never sit above an action row.

#### Scenario: Long run of actions
- **WHEN** a bot records six action entries in a row between two messages
- **THEN** Chat shows one group with the latest three rows and a control saying 3 earlier actions, and activating it shows all six

#### Scenario: Failed row
- **WHEN** Chat shows an action entry whose outcome is failed
- **THEN** its row shows a failed mark and the reason

#### Scenario: Action reaches Chat
- **WHEN** a bot execution's `open_terminal` call succeeds while its Chat is open
- **THEN** a row for it appears without reloading Chat

### Requirement: Action links
A row with a link target SHALL offer one link named for the kind: Open project, Open terminal, Open workflow, Open automation, Open workflow template, Open triggers or Open settings. Activating it SHALL reveal the target on the bot's server through the workspace's existing navigation, the same way choosing it elsewhere in the workspace does. A project or terminal SHALL be revealed as Tabs reveals it, a terminal's workflow by revealing its terminal, an automation in Automations, a workflow template or Settings in Settings, and a trigger by opening the bot's Configure Triggers tab.

When the workspace knows the target no longer exists, activating the link SHALL say so in the row and change nothing else. When the target lives in Settings and the window shows a different server than the bot's, the row SHALL say it is not available from this window.

#### Scenario: Open the created terminal
- **WHEN** Chat shows a done action row for `open_terminal` and the user activates Open terminal
- **THEN** the workspace reveals that terminal as choosing it in Tabs does

#### Scenario: Target gone
- **WHEN** the user activates Open project on a row whose project has since been closed
- **THEN** the row says the project no longer exists and the view does not change

#### Scenario: Open triggers
- **WHEN** the user activates Open triggers on a row for `triggers_create`
- **THEN** the bot's Configure view opens on its Triggers tab
