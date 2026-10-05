## ADDED Requirements

### Requirement: Windows belong to one terminal session

An app window SHALL belong to exactly one terminal session: the session whose MCP capability made the call that opened it. The server SHALL own every window record, holding its identity, title, source, content, the tool input and result it was opened with, and whether it is open or minimised. A window SHALL be reachable only through its owning session and SHALL NEVER be listed, shown, or addressed from another terminal, project, or server. A session SHALL hold at most eight windows; opening another SHALL fail with a bounded error and change nothing. A window SHALL end when the user closes it, when the agent closes it, or when its session ends, and SHALL NOT outlive the server process.

#### Scenario: Window opened by an agent in Terminal 1

- **WHEN** an agent in Terminal 1 opens a window
- **THEN** the window appears in Terminal 1's pane and in no other terminal's pane

#### Scenario: Another terminal names the window

- **WHEN** a call from Terminal 2 names a window that belongs to Terminal 1
- **THEN** the call fails as though the window does not exist and Terminal 1's window is unchanged

#### Scenario: Ninth window

- **WHEN** a session that holds eight windows opens another
- **THEN** the call fails with a bounded error and the eight windows are unchanged

#### Scenario: Terminal closed

- **WHEN** a terminal session that owns windows ends
- **THEN** its windows end with it

### Requirement: Open window placement

An open window SHALL float above its terminal's pane without changing the terminal's size. On a pane at least 560 CSS pixels wide it SHALL, until the user moves or resizes it, be at most 440 pixels wide, sit at the bottom-left of the pane, and take the height of its content, capped at 60% of the pane's height; taller content SHALL scroll inside the window. On a narrower pane it SHALL be a sheet spanning the pane's width at the bottom edge, under the same height cap. A window SHALL have a title bar showing its title and its source, with controls to minimise it, make it fill the pane, and close it. A window's surface SHALL be opaque whatever the terminal's theme background is, so that nothing behind it shows through. Where the pane shows rows of its own under the terminal, such as the software keyboard's accessory row, a window SHALL end above them, including while it fills the pane. On a touch device, the window's title-bar controls SHALL NOT move the keyboard focus, so that using them neither raises nor dismisses the software keyboard.

#### Scenario: Short content on a desktop pane

- **WHEN** a window whose content is 240 pixels tall opens in a pane 700 pixels tall and 1250 pixels wide
- **THEN** it appears at the bottom-left, 440 pixels wide, sized to its content, and the terminal keeps its rows and columns

#### Scenario: Tall content

- **WHEN** a window's content is taller than 60% of the pane
- **THEN** the window is 60% of the pane's height and its content scrolls inside it

#### Scenario: Phone-width pane

- **WHEN** a window opens in a pane 390 pixels wide
- **THEN** it is a sheet spanning the pane's width at the bottom edge with touch-sized title-bar controls

#### Scenario: Sheet while the keyboard accessory row is shown

- **WHEN** a window is open as a sheet on a phone and the terminal's keyboard accessory row is shown
- **THEN** the sheet's bottom edge is the accessory row's top edge and the row stays fully usable

#### Scenario: Translucent terminal theme

- **WHEN** a window opens over a terminal whose theme background is translucent
- **THEN** no terminal output is visible through the window's title bar or body

#### Scenario: Fill the pane

- **WHEN** the user chooses the fill control on an open window
- **THEN** the window covers the whole pane until the user restores or minimises it

### Requirement: One open window per terminal

A terminal SHALL have at most one open window at a time. Opening or restoring a window SHALL minimise every other window of that terminal. A newly created window SHALL start open.

#### Scenario: Second window opens

- **WHEN** a terminal has one open window and a second window is created
- **THEN** the second is open and the first is minimised

#### Scenario: Restoring a minimised window

- **WHEN** the user restores a minimised window while another is open
- **THEN** the restored window is open and the other is minimised

### Requirement: A floating window is moved and resized by the user

On a pane at least 560 CSS pixels wide, the user SHALL be able to move an open window by dragging its title bar and to resize it by dragging any of its edges or corners. A window SHALL stay within its terminal's pane: its title bar SHALL remain inside the pane and above the rail, with at least the left 160 pixels of the title bar visible, while its body MAY extend past the pane's right and bottom edges, where it SHALL be cut off at the pane's edge and SHALL NOT cover anything outside the pane. A resized window SHALL be at least 220 pixels wide with a body at least 80 pixels tall, SHALL keep the size it was given whatever the height of its content, and its view SHALL be told that size; content that does not fit SHALL scroll inside the window. A window that has been moved but not resized SHALL keep taking the height of its content. A window's position and size SHALL be a preference of the client that set them, SHALL be kept while the window is minimised or fills the pane, and SHALL NOT change the terminal's size. A sheet on a narrower pane and a window that fills the pane SHALL NOT be movable or resizable.

#### Scenario: Dragging a window by its title bar

- **WHEN** the user drags an open window's title bar 200 pixels right and 150 pixels up
- **THEN** the window moves by that much and keeps its size

#### Scenario: Dragging a window towards the outside of its pane

- **WHEN** the user drags an open window past the pane's bottom-right corner
- **THEN** its title bar stops inside the pane, its body is cut off at the pane's edge, and nothing outside the pane is covered

#### Scenario: Resizing a window

- **WHEN** the user drags the bottom-right corner of an open window outwards
- **THEN** the window grows by that much, its top-left corner stays where it was, and its view is told the new width and height

#### Scenario: Minimising a moved window

- **WHEN** the user minimises a window they moved and resized, then restores it
- **THEN** it opens where it was left, at the size it was given

#### Scenario: Phone-width pane

- **WHEN** a window is open as a sheet on a pane 390 pixels wide
- **THEN** it cannot be moved or resized

### Requirement: Minimised windows are edge tabs in a rail

A minimised window SHALL appear as a tab attached to the bottom edge of its terminal's pane, showing the window's title and a control that closes the window without opening it. While a terminal has at least one minimised window, the pane SHALL reserve a rail along its bottom edge that holds the tabs, and the terminal viewport SHALL end above the rail so that no terminal output, cursor, or input surface is covered. While a terminal has no minimised window there SHALL be no rail and the terminal SHALL fill the pane. Tabs SHALL line up from the left in creation order. A tab SHALL be draggable along the bottom edge only, and its position SHALL be a preference of the client that moved it. Activating a tab SHALL restore its window. An open window SHALL sit above the rail. Where the pane shows rows of its own under the terminal, such as the software keyboard's accessory row, the rail and its tabs SHALL sit directly above those rows and SHALL NOT cover them. A tab's surface SHALL be opaque.

#### Scenario: Minimising the only window

- **WHEN** the user minimises a terminal's only window
- **THEN** a tab with the window's title appears at the bottom-left, the rail appears, and the terminal ends above the rail

#### Scenario: Minimised window while the keyboard accessory row is shown

- **WHEN** a terminal on a phone has a minimised window and its keyboard accessory row is shown
- **THEN** the tab sits in the rail directly above the accessory row and covers none of its keys

#### Scenario: Closing a window from its tab

- **WHEN** the user activates the close control on a minimised window's tab
- **THEN** the window ends without opening, and its tab is removed

#### Scenario: Restoring the only minimised window

- **WHEN** the user activates the only tab
- **THEN** the window opens, the rail disappears, and the terminal fills the pane

#### Scenario: Dragging a tab

- **WHEN** the user drags a tab
- **THEN** it moves left and right along the bottom edge and does not leave the edge

#### Scenario: Terminal without windows

- **WHEN** a terminal has no windows
- **THEN** its pane has no rail and no tab

### Requirement: The rail resize follows the canonical grid rules

Showing or removing the rail SHALL change the terminal viewport's height on that client only. Where that client is the terminal's presentation holder, it SHALL publish the resulting PTY dimensions under the canonical grid rules; where it is a read-only observer, it SHALL scale the canonical grid locally and SHALL submit no resize.

#### Scenario: Holder minimises a window

- **WHEN** the presentation holder minimises a window and the rail appears
- **THEN** the terminal's rows decrease to fit above the rail and the new dimensions are published once

#### Scenario: Observer shows a rail

- **WHEN** a read-only observer's pane shows the rail
- **THEN** it scales the canonical grid locally and submits no resize

### Requirement: Window badges on terminal and project tabs

A terminal tab SHALL show a window badge while its terminal has at least one window, with a count when there is more than one. A project tab SHALL show the badge while any of its terminals has a window, with the project's total when there is more than one. When a window is created in a terminal the client is not showing, that terminal's badge and its project's badge SHALL pulse until the user shows that terminal. The workspace status bar SHALL NOT list or control windows.

#### Scenario: Window arrives in a background terminal

- **WHEN** an agent opens a window in Terminal 1 while the user is viewing a terminal in another project
- **THEN** Terminal 1's tab badge and its project's tab badge pulse

#### Scenario: Returning to the terminal

- **WHEN** the user shows Terminal 1
- **THEN** the badges stop pulsing and remain while the window exists

#### Scenario: Last window closed

- **WHEN** a terminal's last window closes
- **THEN** its tab badge disappears, and its project's badge disappears if no other terminal in the project has a window

### Requirement: Windows survive terminal and project switches

Switching terminal, project, or layout SHALL NOT reload, reset, or resize a window's view. A view SHALL keep its in-page state while its terminal is not shown, and SHALL be exactly as the user left it when the terminal is shown again. Minimising and restoring a window SHALL NOT reload its view.

#### Scenario: Switch away and back

- **WHEN** the user changes a control inside a window, switches to another project, and switches back
- **THEN** the window is in the same open or minimised state and the control holds the changed value

#### Scenario: Minimise and restore

- **WHEN** the user minimises and restores a window that is running a timer
- **THEN** the view was not reloaded and the timer has continued

### Requirement: The view runs on the client that holds control

A window's view SHALL run only on the client that holds the terminal's interactive presentation lease. Every other attached client SHALL show the window's tab and badge and SHALL NOT run the view; activating the tab there SHALL offer the terminal's ordinary takeover. When the lease moves to another client, the former holder SHALL tear its views down and the new holder SHALL start each view afresh from the server's record, in the same open or minimised state, with the same content, tool input, and tool result. In-page state that the view did not report to the server SHALL NOT transfer.

#### Scenario: Phone takes control

- **WHEN** a window is open on a desktop client and the user takes control of that terminal from a phone
- **THEN** the desktop client stops running the view and shows its tab, and the phone opens the window as a sheet with the same content

#### Scenario: Observer activates a tab

- **WHEN** a read-only observer activates a window's tab
- **THEN** it is offered the terminal's takeover and the view does not run until it holds control

#### Scenario: No client attached

- **WHEN** an agent opens a window while no client is attached to the terminal
- **THEN** the server records the window and the next client to hold control shows it open

### Requirement: Sandboxed view isolation

A view SHALL execute in a browser context whose origin is opaque, and therefore cross-origin to Terminay's application origin and to every other view, with no preload bridge, no Node integration, and no access to Terminay application storage, cookies, or the DOM of the workspace. The view document SHALL be nested inside a Terminay-authored sandbox proxy document whose own origin is also opaque, and SHALL carry a content security policy that Terminay constructs. Where a host serves the proxy over HTTP, its response SHALL force the opaque origin itself, so that opening the proxy outside the workspace grants nothing. A view SHALL NOT navigate the workspace, open windows, or start downloads; a link the view asks to open SHALL be opened only by the host, only for `http` and `https` URLs, through the host's ordinary external-link path. The workspace SHALL confirm that the proxy answers before offering app windows, and a host on which it does not SHALL report app windows as unavailable rather than weakening isolation.

#### Scenario: View reads the parent

- **WHEN** a view attempts to read the workspace's DOM, storage, or cookies
- **THEN** the browser's cross-origin rules deny it

#### Scenario: View navigates the top frame

- **WHEN** a view attempts to navigate the workspace or open a popup
- **THEN** the attempt is blocked

#### Scenario: Proxy opened outside the workspace

- **WHEN** the proxy document is opened directly from a host that serves it over HTTP
- **THEN** it runs in an opaque origin and cannot read the application origin's storage or cookies

#### Scenario: Host that cannot frame the proxy

- **WHEN** the proxy document does not answer on a host
- **THEN** app windows are reported unavailable and no view runs on the application origin

### Requirement: View network policy by source

The content security policy of a view SHALL depend on the window's source. An agent-authored view SHALL be allowed to load scripts, styles, images, fonts, and media from, and connect to, any `https` origin. An MCP App view SHALL be allowed only the origins its UI resource declares, and SHALL be allowed none when it declares none. No view SHALL be allowed plugin content. The policy governs what a view loads, fetches, frames, and navigates to. For an MCP App view it SHALL also ask the browser to refuse WebRTC, which `connect-src` does not govern; where a browser does not honour that request, a peer connection remains possible, and the workspace does not claim otherwise.

#### Scenario: Agent-authored view loads a library

- **WHEN** an agent-authored view includes a script from an `https` CDN
- **THEN** the script loads and runs

#### Scenario: MCP App fetches an undeclared origin

- **WHEN** an MCP App view whose resource declares no connect domains calls `fetch` for an external URL
- **THEN** the request is blocked by the view's content security policy

### Requirement: Validated view message contract

The host SHALL accept from a view only the messages of the MCP Apps host contract: the initialise handshake, size reports, log messages, ping, a request to open a link, a request to change display mode, a message for the conversation, a model-context update, and, for an MCP App view, tool calls and resource reads for its own server. A message SHALL be accepted only from the frame of a live view's sandbox proxy. Any other message SHALL be rejected and SHALL invoke no application command. The host SHALL give a view its theme variables, display mode, container dimensions, and platform, and SHALL notify it when they change. The host SHALL tell a view it is being torn down before removing it.

#### Scenario: Unknown method

- **WHEN** a view sends a request with a method outside the contract
- **THEN** it receives a method-not-found error and nothing else happens

#### Scenario: Message from a foreign frame

- **WHEN** a frame that is not a live view posts a contract-shaped message
- **THEN** it is ignored

#### Scenario: Pane becomes narrow

- **WHEN** the pane of an open window becomes narrower than 560 pixels
- **THEN** the view is told its new container dimensions and that the platform is mobile

### Requirement: Agent-authored views need no protocol code

For an agent-authored view the host SHALL perform the initialise handshake and report content size on the view's behalf, SHALL apply the host theme variables to the document, and SHALL provide a small script interface with operations to send a message to the conversation, update model context, open a link, and close the window. A document consisting only of static HTML SHALL display at its content height with no script.

#### Scenario: Static hello world

- **WHEN** an agent shows a window whose HTML is a heading and a paragraph with no script
- **THEN** the window opens at the height of that content

#### Scenario: Button sends a message

- **WHEN** a button in an agent-authored view calls the provided send-message operation with "Use the blue theme"
- **THEN** the host handles it as a window message from that window

### Requirement: Window messages are typed into the owning terminal

When a view sends a message for the conversation, the server SHALL evaluate the Window Messages policy and, when permitted, SHALL write the message text to the window's owning terminal as one paste, using bracketed paste when the terminal has enabled it, and SHALL then submit it once. The text SHALL be bounded to 16 KiB and SHALL be rejected when empty or over the bound. The message SHALL go to the owning terminal whichever terminal the client is showing, and only a request from the client holding that terminal's presentation lease SHALL be honoured. After a message is sent the window SHALL minimise so the terminal is visible.

#### Scenario: Button in a window sends a message

- **WHEN** the user presses a button in a window of Terminal 1 that sends "Deploy api to eu-west-1"
- **THEN** that text is pasted into Terminal 1 and submitted once, and the window minimises

#### Scenario: Message from an observer

- **WHEN** a window-message request arrives from a client that does not hold the terminal's presentation lease
- **THEN** it is refused and nothing is written to the terminal

#### Scenario: Oversized message

- **WHEN** a view sends a message longer than 16 KiB
- **THEN** it is rejected with an error to the view and nothing is written

### Requirement: Model context from a window

When a view updates model context, the server SHALL keep the most recent update for that window, bounded to 16 KiB, and SHALL append it once to the result of the next MCP tool call made from the owning terminal, labelled with the window's title. A later update SHALL replace an undelivered earlier one. An update SHALL NOT type anything into the terminal.

#### Scenario: Selection reaches the model

- **WHEN** a view updates model context with the user's current selection and the agent then calls any Terminay MCP tool from that terminal
- **THEN** the tool result ends with the selection, labelled with the window's title, and the next tool result does not repeat it

#### Scenario: Two updates before a tool call

- **WHEN** a view updates model context twice before the next tool call
- **THEN** only the second update is delivered

### Requirement: App windows capability and host parity

App windows SHALL be offered behind a protocol capability, and a client that does not negotiate it SHALL behave as though no terminal has windows. Placement, the rail, tabs, badges, the view contract, and isolation SHALL be identical in the Desktop and browser hosts, and SHALL be usable by touch on a phone-width client.

#### Scenario: Older client

- **WHEN** a client that lacks the capability attaches to a terminal that has windows
- **THEN** it shows the terminal as usual with no window, tab, rail, or badge

#### Scenario: Same window on both hosts

- **WHEN** the same window is opened in the Desktop host and in a browser host at the same pane size
- **THEN** its placement, controls, and behaviour are the same

### Requirement: A view stays the document it was given

A view's frame SHALL hold only the document the workspace gave it. No document from another address SHALL load in the frame, whether the view sets its own location, follows a link, submits a form, or carries a refreshing `meta`; and no such document SHALL speak as the view. A view whose frame comes to load a second document, or which writes a new document over itself, SHALL be removed, and its window SHALL say that it stopped and why, and SHALL remain closable. A view MAY still frame what its own policy allows.

The workspace does not claim that an attempted navigation is invisible on the network. A browser may open a connection to the destination before it refuses to load it, so the name of a host a view chooses can leave by name lookup and connection setup. The address beyond the host name, and any content, do not.

#### Scenario: A view navigates itself

- **WHEN** a view sets its own location to another site
- **THEN** no page from that site loads in the window or speaks as the view, the view is removed, and the window says it stopped because its page tried to leave

#### Scenario: A view declared with no network

- **WHEN** an MCP App view whose policy allows no connections tries to send data out by navigating to a URL that carries it
- **THEN** no request for that URL is made and no page is loaded

#### Scenario: A view rewrites itself

- **WHEN** a view calls `document.open` and writes a new document after it has loaded
- **THEN** the view is removed and the window says why

### Requirement: Links in a view do what they are for

A link in a view SHALL NOT navigate the view. Activating a link to a place in the same document SHALL scroll to that place. Activating a link to a web page SHALL ask the host to open it in the user's browser, under the same rule as any request to open a link, and the view SHALL remain as it was.

#### Scenario: A link to a section

- **WHEN** the user clicks `<a href="#details">` in a view
- **THEN** the view scrolls to the element with that id and keeps running

#### Scenario: A link to a web page

- **WHEN** the user clicks a link to an `https` page in a view
- **THEN** the page opens in the user's browser and the view is unchanged

### Requirement: A view cannot take the keyboard

A view SHALL hold the keyboard focus only when the user gave it: by clicking or tapping in the view, or by moving the focus into it with the keyboard. When a view takes the focus by itself, the workspace SHALL return the focus to the terminal, so that keys typed for the terminal are not delivered to the view and cannot count as the user's gesture in it.

#### Scenario: A view focuses itself as it loads

- **WHEN** a view calls `focus` on itself as soon as it is shown, while the user is typing in the terminal
- **THEN** the terminal keeps the focus, the keys go to the terminal, and the view receives none

#### Scenario: The user clicks into a view

- **WHEN** the user clicks a text field in a view and types
- **THEN** the view has the focus and receives the keys

### Requirement: A window message is text

Text a view sends to be typed into its terminal SHALL contain no control characters other than tab and line feed; the server SHALL refuse a message that does, and SHALL write nothing. A permitted message SHALL be submitted to the terminal exactly once: where the terminal has not enabled bracketed paste, its line breaks and tabs SHALL be written as spaces, since each would be a keystroke there. Text a view leaves as context for the model SHALL be held to the same characters.

#### Scenario: A view sends an escape sequence

- **WHEN** a view sends a message containing an escape sequence, an interrupt character, or a carriage return
- **THEN** the server refuses it and nothing is written to the terminal

#### Scenario: A multi-line message in a plain shell

- **WHEN** a view sends a two-line message to a terminal that has not enabled bracketed paste
- **THEN** the terminal receives the two lines joined by a space, followed by one Enter

### Requirement: Windows are visible only within a client's boundary

A client authenticated into one project, or one terminal session, SHALL see and act on only the windows of that project or session: windows outside it SHALL NOT be listed to it, and reading, changing, closing, or watching one SHALL be refused as though it did not exist.

#### Scenario: A client bound to another project

- **WHEN** a client bound to project B lists windows, or asks for the content of a window in project A
- **THEN** the list omits project A's windows and the content request is refused

### Requirement: A window that cannot be loaded says so

When the controlling client cannot obtain a window's content, the window SHALL say that it could not be loaded and SHALL remain closable. Tool input, tool results, and a view's own requests and responses SHALL be carried at their permitted sizes, not limited by the size of a protocol envelope.

#### Scenario: A tool result of several hundred kilobytes

- **WHEN** a connected tool with a view returns a 300 KiB result
- **THEN** the view receives the whole result

#### Scenario: Content cannot be fetched

- **WHEN** the server cannot deliver a window's content
- **THEN** the window shows that it could not be loaded, and can be closed

### Requirement: A view acts for the user only on the user's gesture

A view's request to type a message into its terminal, or to open a link in the browser, SHALL be honoured only while the user has just interacted with that view: a click, tap, or key press in it. A request made without one, such as one a document makes as it loads, SHALL be refused and the view told so. Whether the user has interacted SHALL be established by the sandbox proxy from the browser's own record of user activation, never from anything the view says.

A message SHALL be accepted only from a window that is open, SHALL be refused when it is white space alone, and one window SHALL have at most one message being delivered at a time. Because a delivered message minimises its window, a window sends one message each time the user opens it. Links SHALL be opened no faster than one a second per view.

#### Scenario: A view sends a message as it loads

- **WHEN** a view sends a message for the terminal as soon as it is shown, before the user has touched it
- **THEN** nothing is written to the terminal and the view is told the user is not using the window

#### Scenario: A view sends white space

- **WHEN** a view sends a message that is only a line break
- **THEN** the server refuses it, and no Enter is written to the terminal

#### Scenario: A view sends a burst of messages

- **WHEN** a view sends twenty messages at once after one click
- **THEN** one is written to the terminal, the window is minimised, and the rest are refused

#### Scenario: A view opens a link as it loads

- **WHEN** a view asks to open a link before the user has touched it
- **THEN** no browser is opened

### Requirement: The controlling client is a connection, not a name

Where an operation is reserved to the client controlling a terminal, the server SHALL require the connection that holds the terminal's presentation lease. Another connection that presents the same client identifier SHALL NOT be treated as the controller.

#### Scenario: A second connection names the controlling client

- **WHEN** a connection that has not attached to the terminal presents the controlling client's identifier and sends a window message
- **THEN** the server refuses it and nothing is written to the terminal

### Requirement: A failed read does not end running views

When a client fails to read the list of windows from a server it has already read from, it SHALL keep showing the windows it had, with their views running, and SHALL read again when the server next reports a change or reports that changes were missed.

#### Scenario: One list request fails

- **WHEN** a client's request for the window list fails once while a view is running
- **THEN** the view keeps running with its state
