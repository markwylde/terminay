## MODIFIED Requirements

### Requirement: Desktop

Environment › Desktop SHALL show the bot's desktop live, in either view-only or control mode. It SHALL open in view-only mode. The user SHALL be able to switch modes, open the desktop in its own window, and reconnect.

- **Authentication.** The desktop's VNC service SHALL require a password. The server SHALL hold the password in its vault and SHALL deliver it at start through a root-only bootstrap. The desktop SHALL NOT start until the bootstrap completes, and a container that receives no bootstrap SHALL exit. The `bot` user SHALL NOT be able to read the password.
- **Transport.** The VNC service SHALL listen only on the container's own loopback. The server SHALL reach it through an engine `exec` stream into the container, and SHALL relay the desktop to the client through the Terminay connection, so no port is published and remote clients need no other port.
- **Stream binding.** Each desktop stream SHALL be bound to the authorized client connection, the bot, the mode, and a stream generation. Changing the mode SHALL open a new stream.
- **Allowlist.** The server SHALL forward only a bounded allowlist of client messages, and SHALL close the stream on any unknown or oversized message. `ClientCutText` SHALL be admitted in its Latin-1 form and in its extended form. The payload of either form SHALL be at most 1 MiB, and an extended payload SHALL be at least its 4-byte flags.
- **View-only enforcement.** In view-only mode, the server SHALL discard every keyboard, pointer, and clipboard message.
- **Clipboard.** In control mode, the desktop SHALL share clipboard text with the device showing it, in both directions:
  - **Bot to device.** When the bot's clipboard changes, the client SHALL write its text to the device's clipboard through the host's clipboard-write route. It SHALL do so only while the desktop holds keyboard focus and its window is focused and visible. The client SHALL drop the change otherwise, and SHALL NOT write it later. The client SHALL NOT write text that is empty, longer than 1 MiB of UTF-8, or that contains a control character other than tab, line feed, or carriage return.
  - **Device to bot.** When the user presses the device's paste shortcut on the focused desktop, the client SHALL send the device's clipboard text to the bot's clipboard. In Desktop, the client SHALL cancel the shortcut and read that text through the terminal paste bridge, taking text only. Elsewhere, it SHALL take the text of the native paste that the shortcut raises. It SHALL then press the matching Linux paste chord in the bot, regardless of which host modifiers noVNC is holding there. The shortcuts are Ctrl+V, Ctrl+Shift+V and Shift+Insert, or Cmd+V and Cmd+Shift+V on macOS. The chords are Ctrl+V, Ctrl+Shift+V and Shift+Insert. The paste SHALL reach the bot even when text elsewhere in Terminay is still selected, and keyboard focus SHALL be back on the desktop once it is sent. A paste with no text, or a clipboard holding only files or images, SHALL send nothing. The client SHALL NOT read the device's clipboard any other way.
  - **Limits.** Text whose UTF-8 encoding is longer than 1 MiB, with line endings counted as CRLF, SHALL NOT be sent to the bot. The desktop bar SHALL say that the paste was too large. The bot's desktop SHALL accept clipboard text up to that size.
  - **Selections.** Selecting text in the bot without copying it SHALL NOT change the device's clipboard. The server SHALL ensure this on the bot's running desktop before it relays a control-mode stream.
  - **Unicode.** Text SHALL keep characters outside Latin-1 when the client and the server both support the extended form.
  - **View-only.** A view-only stream, including the thumbnail, SHALL neither read nor write either clipboard.
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

#### Scenario: Copy from the bot

- **WHEN** a user in control mode selects `café ✓` in an application on the bot's desktop and presses Ctrl+C there
- **THEN** the client asks the device to write `café ✓` to its clipboard, and the device clipboard holds it unless the host refuses the write

#### Scenario: Paste into the bot

- **WHEN** a user copies text on their device, then focuses the bot's desktop in control mode and presses the device's paste shortcut in a bot text field
- **THEN** that text is pasted into the bot's text field exactly once

#### Scenario: Paste with text selected elsewhere

- **WHEN** a user selects text elsewhere in Terminay, clicks into the bot's desktop in control mode, and presses the device's paste shortcut in a bot text field
- **THEN** the device's clipboard text is pasted into the bot's text field exactly once, the selected text elsewhere is unchanged, and the desktop keeps keyboard focus

#### Scenario: Paste on macOS

- **WHEN** a macOS user in control mode presses Cmd+V on the desktop, with either Cmd key
- **THEN** the bot receives Ctrl+V and no Alt or Super modifier with it, and the host clipboard text is pasted

#### Scenario: Paste in Desktop

- **WHEN** a Desktop user copies text on their device and presses the paste shortcut on the bot's focused desktop in control mode
- **THEN** the text is read through the terminal paste bridge and pasted into the bot exactly once, and noVNC never receives the shortcut

#### Scenario: Paste with nothing to paste

- **WHEN** the device's clipboard holds no text, for example only an image, and the user presses the paste shortcut on the desktop
- **THEN** nothing is sent to the bot and no key is pressed there

#### Scenario: Paste too large

- **WHEN** the user pastes text longer than 1 MiB onto the desktop
- **THEN** nothing is sent to the bot and the desktop bar says the paste was too large

#### Scenario: Selection alone

- **WHEN** a user in control mode highlights text on the bot's desktop without copying it
- **THEN** the user's device clipboard is unchanged, including on a bot whose container was created before this behaviour existed

#### Scenario: Bot copies while the user is elsewhere

- **WHEN** a process on the bot's desktop changes the bot's clipboard while the user's keyboard focus is outside the desktop, or the window is in the background or hidden
- **THEN** the user's device clipboard is unchanged, and stays unchanged when the user returns

#### Scenario: Control characters from the bot

- **WHEN** the bot's clipboard changes to text containing an escape character while the user controls the focused desktop
- **THEN** the device's clipboard is unchanged

#### Scenario: View-only clipboard

- **WHEN** a user viewing the desktop in view-only mode copies on the bot's desktop, or presses the paste shortcut on the desktop
- **THEN** neither the device's clipboard nor the bot's clipboard changes
