## MODIFIED Requirements

### Requirement: Desktop

Environment › Desktop SHALL show the bot's desktop live, in either view-only or control mode. It SHALL open in view-only mode. The user SHALL be able to switch modes, open the desktop in its own window, and reconnect.

- **Authentication.** The desktop's VNC service SHALL require a password. The server SHALL hold the password in its vault and SHALL deliver it at start through a root-only bootstrap. The desktop SHALL NOT start until the bootstrap completes, and a container that receives no bootstrap SHALL exit. The `bot` user SHALL NOT be able to read the password.
- **Transport.** The VNC service SHALL listen only on the container's own loopback. The server SHALL reach it through an engine `exec` stream into the container, and SHALL relay the desktop to the client through the Terminay connection, so no port is published and remote clients need no other port.
- **Stream binding.** Each desktop stream SHALL be bound to the authorized client connection, the bot, the mode, and a stream generation. Changing the mode SHALL open a new stream.
- **Allowlist.** The server SHALL forward only a bounded allowlist of client messages, and SHALL close the stream on any unknown or oversized message. `ClientCutText` SHALL be admitted in its Latin-1 form and in its extended form. The payload of either form SHALL be at most 1 MiB, and an extended payload SHALL be at least its 4-byte flags.
- **View-only enforcement.** In view-only mode, the server SHALL discard every keyboard, pointer, and clipboard message.
- **Clipboard.** A Desktop host SHALL keep its clipboard text synchronized with the selected connected, visible control-mode desktop, independently of paste shortcuts:
  - **Host to bot.** Starting sharing SHALL copy the host's current eligible text into the bot clipboard. Subsequent host copies SHALL update the bot clipboard, including copies made while another host application is focused. Synchronizing SHALL NOT press a paste key or insert text into an application.
  - **Bot to host.** A bot clipboard change during the sharing session SHALL update the host clipboard, including while the Desktop window lacks focus. Highlighting PRIMARY alone SHALL NOT update the host clipboard.
  - **Paste.** The bot's own context-menu Paste, Ctrl+V, Ctrl+Shift+V, and Shift+Insert SHALL use the synchronized clipboard, subject to the target application's bindings. On macOS, Cmd+V and Cmd+Shift+V SHALL also paste through the matching Linux chords. The complete chord SHALL be pressed regardless of host modifier release timing.
  - **Ownership.** A host SHALL share with at most one bot desktop at a time: the most recently selected control desktop. Selecting another control desktop SHALL retire the prior session. Closing, disconnecting, hiding that desktop behind another view, or choosing view-only SHALL retire its sharing session. Merely switching focus to another host application SHALL NOT retire it. Sharing SHALL NOT fan clipboard text out to other bots or windows.
  - **Ordering.** Changes SHALL be applied in observation order. Starting a sharing session SHALL use the host as the initial source; afterward the latest observed eligible change SHALL win. An echoed change SHALL NOT cause repeated clipboard writes. No result from a retired sharing session SHALL update either clipboard.
  - **Limits.** Sharing SHALL transfer non-empty text only, at most 1 MiB of UTF-8 with host-to-bot line endings counted as CRLF and the terminating NUL counted. Bot-to-host text SHALL contain no control characters other than tab, LF, or CR. Copied files and images SHALL NOT be transferred. Too-large host text SHALL produce the desktop bar's paste-too-large notice. Clipboard contents SHALL NOT be persisted or logged.
  - **Selections.** The server SHALL isolate PRIMARY on the running bot before admitting a control stream, including on an existing container.
  - **Unicode.** Text SHALL retain characters outside Latin-1 when both endpoints support ExtendedClipboard.
  - **View-only.** View-only streams, including thumbnails, SHALL neither read nor write either clipboard.
  - **Browser hosts.** Where the host cannot provide clipboard synchronization, the focused control desktop SHALL accept the text of native paste events, keep the shortcut away from noVNC, and press the complete matching Linux chord. Unavailable continuous synchronization SHALL be presented honestly, without requesting ambient browser clipboard permission.
- **Thumbnail.** The context rail's thumbnail SHALL be a view-only relay of the same desktop, shown only while the container runs. Activating it SHALL open Desktop.
- **Idle stop.** Viewing the desktop SHALL count as activity for idle stop.

#### Scenario: Remote client

- **WHEN** a paired remote browser client opens a bot's Desktop
- **THEN** the desktop is shown through the Terminay connection and no container port is reachable from that device

#### Scenario: Forged input in view-only mode

- **WHEN** a client in view-only mode sends a pointer event over the desktop stream
- **THEN** the server discards it and the bot's desktop receives no input

#### Scenario: Malformed traffic

- **WHEN** a client sends an unknown RFB message type, or a `ClientCutText` whose payload is longer than 1 MiB in either form
- **THEN** the server closes that desktop stream and the bot's desktop receives nothing

#### Scenario: No bootstrap

- **WHEN** a bot's container starts but the server never delivers the bootstrap
- **THEN** the container exits and no desktop service listens

#### Scenario: No direct connection

- **WHEN** a process on the server machine, or in another bot, tries to connect to a bot's desktop
- **THEN** there is no published port to connect to, and inside the bot's own container the VNC service still requires the password

#### Scenario: Host copy supports context-menu paste

- **WHEN** sharing is active and a user copies `i have copied this from my mac` in another Mac application, then right-clicks the bot browser's address bar
- **THEN** Paste is available and choosing it inserts that text exactly once, without first pressing Cmd+V

#### Scenario: Start sharing

- **WHEN** a user enters control mode with eligible text already in the host clipboard
- **THEN** the bot clipboard receives that text without inserting it into any application

#### Scenario: Linux paste shortcut on a Mac host

- **WHEN** a Mac user copies text while sharing is active, then presses Ctrl+V in the bot's browser address bar
- **THEN** the browser pastes the synchronized text exactly once

#### Scenario: Copy from the bot

- **WHEN** a bot application copies `café ✓` while sharing is active
- **THEN** the host clipboard holds that text, and its echo causes no further writes

#### Scenario: Bot copies while the user is elsewhere

- **WHEN** the Desktop window loses focus to another Mac application while its selected control desktop remains open and visible
- **THEN** clipboard text continues to synchronize in both directions

#### Scenario: Another desktop is selected

- **WHEN** a user selects a different bot's control desktop, including in another window
- **THEN** the old sharing session retires, the new desktop receives the current host text, and subsequent clipboard changes reach only the new desktop

#### Scenario: Sharing ends

- **WHEN** the desktop closes, disconnects, is hidden by another view, or changes to view-only
- **THEN** clipboard observation and forwarding stop, and pending results from the retired session have no effect

#### Scenario: Simultaneous changes

- **WHEN** host and bot text changes are observed while a previous update is still awaiting completion
- **THEN** writes are serialized in observation order and the latest observed eligible change wins without an echo loop

#### Scenario: Paste on macOS

- **WHEN** a user presses Cmd+Shift+V and releases Shift before the clipboard read completes
- **THEN** the bot still receives the complete Ctrl+Shift+V chord without Alt or Super

#### Scenario: Paste with text selected elsewhere

- **WHEN** a browser host without continuous synchronization raises a native paste event on the focused control desktop, including with a stale selection elsewhere in Terminay
- **THEN** its text reaches the bot and is pasted once, and keyboard focus returns to the desktop

#### Scenario: Paste with nothing to paste

- **WHEN** the clipboard contains no eligible text or only files or images
- **THEN** no clipboard text or paste key is sent

#### Scenario: Selection alone

- **WHEN** a user highlights text in the bot without copying it
- **THEN** the host clipboard remains unchanged

#### Scenario: Control characters from the bot

- **WHEN** bot clipboard text contains an escape character
- **THEN** the host clipboard remains unchanged

#### Scenario: View-only clipboard

- **WHEN** a desktop is view-only or a thumbnail
- **THEN** it neither reads nor writes either clipboard

#### Scenario: Paste into the bot

- **WHEN** a user copies text on the host during sharing and invokes Paste in a bot text field
- **THEN** the copied text is inserted exactly once

#### Scenario: Paste in Desktop

- **WHEN** a Desktop user presses Cmd+V on macOS or the host paste shortcut on the focused control desktop
- **THEN** the current host text is published and pasted once through a complete matching Linux chord

#### Scenario: Paste too large

- **WHEN** host text exceeds the sharing size limit
- **THEN** it is not sent and the desktop bar reports that it is too large
