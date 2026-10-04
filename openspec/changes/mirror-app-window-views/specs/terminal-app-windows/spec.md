## MODIFIED Requirements

### Requirement: The view runs on the client that holds control

A window's view SHALL run only on the client that holds the terminal's interactive presentation lease. Every other attached client SHALL show the window's tab and badge and SHALL NOT run the view; where the view mirror is available it SHALL show a live, read-only mirror of the view in the window, and otherwise it SHALL show a notice that the window runs on the controlling device. In both cases the window SHALL offer the terminal's ordinary takeover. When the lease moves to another client, the former holder SHALL tear its views down and the new holder SHALL start each view afresh from the server's record, in the same open or minimised state, with the same content, tool input, and tool result. In-page state that the view did not report to the server SHALL NOT transfer, and a mirror SHALL NOT become a running view.

#### Scenario: Phone takes control

- **WHEN** a window is open on a desktop client and the user takes control of that terminal from a phone
- **THEN** the desktop client stops running the view and shows a mirror of it, and the phone opens the window as a sheet and runs the view from the server's record

#### Scenario: Observer activates a tab

- **WHEN** a read-only observer activates a window's tab
- **THEN** the window opens showing the mirror, offers the terminal's takeover, and the view itself does not run on that client until it holds control

#### Scenario: No client attached

- **WHEN** an agent opens a window while no client is attached to the terminal
- **THEN** the server records the window and the next client to hold control shows it open

## ADDED Requirements

### Requirement: Observers see a live mirror of a view

A client attached to a terminal without holding its interactive presentation lease SHALL show, in each open window of that terminal, a mirror of the view as the controlling client currently displays it: its document, later changes to the document, the values of its form controls, its scroll position, and the controlling client's pointer. The mirror SHALL follow the view without the observer doing anything. The window SHALL be marked as a mirror in words, not by colour alone.

#### Scenario: A change in the view reaches an observer

- **WHEN** the person in control types into a text field of a view while another client observes the terminal
- **THEN** the observer's mirror shows the typed text without the observer reloading or reopening the window

#### Scenario: The agent replaces a window's document

- **WHEN** the agent replaces a window's document while an observer is watching
- **THEN** the observer's mirror shows the new document

#### Scenario: A minimised window

- **WHEN** a window is minimised
- **THEN** an observer sees its tab, and no mirror is shown until the window is opened on the observer's client

### Requirement: A mirror is read-only

A mirror SHALL NOT accept input. Pointer, keyboard, and touch input on a mirror SHALL NOT reach the view, the terminal, or any tool, and a mirror SHALL NOT send a window message, update model context, call a tool, or open a link. Window controls that change shared window state (minimise, restore, close) SHALL remain available to an observer as they are without a mirror.

#### Scenario: Clicking a button in a mirror

- **WHEN** an observer clicks a button shown in a mirror
- **THEN** nothing is sent to the view or the terminal, and the window offers the takeover

### Requirement: A mirror fits the observer's window

A mirror SHALL be laid out at the size of the view on the controlling client and scaled uniformly to fit the width of the observer's window, so that it is not cropped and does not scroll horizontally. The observer's window SHALL take its height from the scaled mirror, within the same limits as any window.

#### Scenario: Desktop view watched from a phone

- **WHEN** a view 440 pixels wide on a desktop client is mirrored in a 390 pixel wide sheet on a phone
- **THEN** the whole width of the view is visible in the sheet, scaled down

### Requirement: The controlling client records only while someone is watching

The controlling client SHALL record a view only while at least one other client is watching that terminal's windows, and SHALL stop when none is. A window whose view is not being recorded SHALL behave exactly as a window does without the mirror.

#### Scenario: Nobody else is attached

- **WHEN** one client is attached to a terminal and a window is open
- **THEN** the view is not recorded and nothing about it is sent to the server beyond what a window sends without the mirror

#### Scenario: A second client attaches

- **WHEN** a second client attaches to a terminal that has an open window
- **THEN** the controlling client starts recording and the second client's mirror shows the view as it is at that moment, including state the view reached before the second client attached

### Requirement: The server relays a recording and does not keep it

The server SHALL accept a recording of a view only from the client that holds the terminal's interactive presentation lease, and SHALL deliver it only to clients attached to that terminal's project with permission to read its terminals. The server SHALL NOT store a view's recording beyond delivering it, SHALL NOT write it to disk, and SHALL NOT interpret it. A recording SHALL NOT be available through any MCP tool.

#### Scenario: A client without control publishes a recording

- **WHEN** a client that does not hold the lease sends a recording for a window
- **THEN** the server refuses it and delivers nothing to other clients

#### Scenario: A recording after takeover

- **WHEN** the lease moves while the former holder still has recording data in flight
- **THEN** the server refuses what arrives from the former holder after the move

### Requirement: A mirror recovers by a fresh snapshot

A client that starts watching, a client that reconnects, and a mirror that receives a recording it cannot apply in order SHALL obtain a complete snapshot of the view from the controlling client and continue from it. An observer SHALL NOT show a mirror that is known to be out of step; while it waits for a snapshot it SHALL show that the mirror is loading.

#### Scenario: Observer reconnects

- **WHEN** an observer loses and regains its connection while a window is open
- **THEN** its mirror shows the view's current state without the controlling client's view reloading

#### Scenario: A gap in the recording

- **WHEN** an observer receives part of a recording out of order
- **THEN** it discards the mirror's state, shows loading, and resumes from a fresh snapshot

### Requirement: Excluded content is masked or left out

The value of a password field SHALL NOT leave the controlling client; a mirror SHALL show it masked. Canvas content, video, audio, and frames from another origin inside a view SHALL NOT be mirrored, and a mirror SHALL show a placeholder of the same size in their place.

#### Scenario: Password field

- **WHEN** the person in control types into a password field in a view
- **THEN** observers see the field filled with mask characters and the typed characters are not sent to the server

### Requirement: A view of any size is mirrored

The size of a view SHALL NOT decide whether it is mirrored. A snapshot too large for one message SHALL be streamed in parts, and an observer SHALL show it once every part has arrived, continuing to show what it had until then. The controlling client SHALL send one message at a time and wait for it to be accepted before sending the next, so that a busy or large view is paced by the connection and not dropped.

An observer whose connection repeatedly fails to deliver a whole snapshot SHALL stop asking after a small fixed number of attempts, SHALL show that the window cannot be mirrored and that it is running on the controlling device, and SHALL show the mirror again when a whole snapshot next arrives. The view on the controlling client SHALL be unaffected throughout.

#### Scenario: A view of several megabytes

- **WHEN** a view's document grows to several megabytes while an observer is watching
- **THEN** the observer's mirror shows the whole view, including the new content

#### Scenario: A connection that cannot keep up

- **WHEN** part of every snapshot is lost on the way to an observer
- **THEN** the observer asks again a fixed number of times, then shows that the window cannot be mirrored and stops asking, and the view keeps working on the controlling client

#### Scenario: The connection recovers

- **WHEN** a whole snapshot reaches an observer that had stopped asking
- **THEN** its mirror shows the view again

### Requirement: A mirror is isolated as a view is

A mirror SHALL be rendered inside the same sandbox as a view: an opaque origin, with no access to the workspace document, Terminay storage, the host bridge, or the protocol. Script contained in a recording SHALL NOT run in a mirror. A mirror SHALL load subresources under the same network policy as the view it mirrors.

#### Scenario: A recording that carries script

- **WHEN** a view's document contains a script element or an inline event handler
- **THEN** the mirror shows the document and runs neither

#### Scenario: A forged recording

- **WHEN** a view sends recording data crafted to reach the workspace
- **THEN** the workspace treats it as opaque data, relays it within the limits, and nothing outside the mirror's sandbox is affected

### Requirement: View mirror capability

The view mirror SHALL be a negotiated capability, `app-window-mirror.v1`, offered only by a server and client that both offer app windows. Where either side lacks it, an observer SHALL show the notice that the window runs on the controlling device, and the controlling client SHALL NOT record.

#### Scenario: Older observer

- **WHEN** an observer that does not offer the capability attaches to a terminal with an open window
- **THEN** it shows the notice, and it does not count as a watcher that starts recording
