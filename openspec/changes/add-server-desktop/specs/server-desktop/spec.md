## ADDED Requirements

### Requirement: A standalone server reports whether it offers a desktop

A standalone server SHALL advertise the `server-desktop.v1` feature capability and SHALL answer `server.desktop.status` with exactly one state:

- `unsupported`, with a reason, when the host cannot offer a desktop. A host is supported only when it runs Linux, its `os-release` identifies Debian, the server shares the host's temporary directory with the programs it starts, and the display server can be started without network access.
- `needs-setup`, when the host is supported and a required program is absent. The status SHALL say whether the server can run setup itself or the operator must run a command, and SHALL carry that command.
- `setting-up`, with the current step and a completed fraction.
- `ready`, when the desktop is running, with its display number.
- `off`, when the desktop is set up and has been turned off.
- `failed`, with a reason, when setup or the desktop's start failed.

The server SHALL publish each state change only to attached clients that hold desktop authority. An embedded server SHALL NOT advertise the capability.

#### Scenario: Debian server before setup

- **WHEN** a client asks a standalone Debian server without the display server installed for desktop status
- **THEN** the state is `needs-setup` and the status says how setup can be run

#### Scenario: Unsupported distribution

- **WHEN** a client asks a standalone server on a non-Debian host for desktop status
- **THEN** the state is `unsupported` with a reason naming the supported hosts, and no desktop process is started

#### Scenario: Private temporary directory

- **WHEN** the server's service has a temporary directory private to itself
- **THEN** the state is `unsupported` with a reason saying the server's temporary directory is private, and no desktop process is started

#### Scenario: Network access cannot be dropped

- **WHEN** the host offers no way to start the display server without network access
- **THEN** the state is `unsupported` with that reason, and no display server is started

#### Scenario: Embedded server

- **WHEN** a client negotiates with a server embedded in Terminay Desktop
- **THEN** `server-desktop.v1` is not advertised

### Requirement: Show Desktop sits beside the server menu

A window connected to a server that advertises `server-desktop.v1` SHALL show a Show Desktop control beside the server menu. A window whose server does not advertise it SHALL NOT show the control. Activating the control SHALL open a dropdown beneath it for that window's server, and activating it again, pressing outside the dropdown, or pressing Escape SHALL close it. The dropdown SHALL present the server's state:

- `ready` shows a live, scaled copy of the desktop, who controls it, a way to take or give up control, and an action that opens the desktop in a tab.
- `needs-setup` and `setting-up` show guided setup.
- `off` offers to turn the desktop on.
- `unsupported` shows the reason and no action.
- `failed` shows the reason and a retry.

#### Scenario: Ready desktop

- **WHEN** a user activates Show Desktop on a server whose desktop is `ready`
- **THEN** a dropdown opens showing a live copy of the whole desktop and an action to open it in a tab

#### Scenario: Server without the capability

- **WHEN** a window is connected to a server that does not advertise `server-desktop.v1`
- **THEN** no Show Desktop control is shown

#### Scenario: Unsupported host

- **WHEN** a user activates Show Desktop on a server whose state is `unsupported`
- **THEN** the dropdown shows the reason, and shows no install, retry, or turn-on action

### Requirement: Guided setup installs a fixed package set

When the state is `needs-setup` and the server can run setup itself, the dropdown and every desktop tab SHALL offer to install the desktop. Accepting SHALL send `server.desktop.setup`, which SHALL carry nothing: any field SHALL be rejected as a validation error and SHALL NOT start setup. Setup SHALL install only the packages named in the installed Terminay release and the dependencies the host's package manager resolves for them, from the host's configured package sources. It SHALL NOT add a package source, and SHALL NOT leave any system service enabled or running that was not before. A request made while setup is running SHALL join that setup.

The dropdown SHALL show setup's named steps and a progress bar driven by the package manager's own reported progress, and SHALL show the same setup after the dropdown is reopened or the client reconnects. When setup completes, the desktop SHALL start unless it has been turned off, and the dropdown SHALL show it. When setup fails, the state SHALL be `failed` with the failing step and its reason. A setup run that ends without recording an outcome SHALL be reported as `failed`, never left as `setting-up`.

#### Scenario: First use on a system-scope install

- **WHEN** a user activates Show Desktop on a Debian system-scope server without the display server and accepts setup
- **THEN** the packages are installed without the user typing a command, the dropdown shows each step and a moving progress bar, and the desktop appears when setup completes

#### Scenario: Setup carries a parameter

- **WHEN** a client sends `server.desktop.setup` with any field
- **THEN** the request is rejected as a validation error and nothing is installed

#### Scenario: Reconnect during setup

- **WHEN** a client reconnects while setup is running
- **THEN** it shows the same setup at its current step and fraction

#### Scenario: Package source unreachable

- **WHEN** setup cannot download a package
- **THEN** the state is `failed`, the dropdown names the download step and the package manager's error, and a retry runs setup again

#### Scenario: Setup process killed

- **WHEN** the setup process is killed before it records an outcome
- **THEN** the state becomes `failed` with a reason saying setup ended unexpectedly

#### Scenario: Setup interrupted

- **WHEN** setup is interrupted partway through installing a package and is run again
- **THEN** the second run completes the installation and exits successfully

### Requirement: Setup by command where the server cannot elevate

When the server has no setup helper and cannot run the setup command with passwordless elevation, the dropdown and every desktop tab SHALL show the one command that performs the same setup, with a way to copy it and a Check again action. The server SHALL re-examine the host when asked for status and when Check again is used, and SHALL start the desktop once the required programs are present, unless it has been turned off.

#### Scenario: User-scope install

- **WHEN** a user opens the desktop dropdown on a user-scope install without the display server
- **THEN** the dropdown shows the setup command and no install button

#### Scenario: Elevation present but refused

- **WHEN** an elevation program is installed but refuses to run without a password
- **THEN** the dropdown shows the setup command and no install button

#### Scenario: Command has been run

- **WHEN** the operator has run the command and the user chooses Check again
- **THEN** the desktop starts and the dropdown shows it

### Requirement: Terminay runs its own display server

The server SHALL start and supervise its own display server and desktop session as processes of the server's own account on the server's own host. It SHALL NOT connect to, configure, signal, or reuse any X or VNC server, session, or per-user VNC configuration that Terminay did not create.

The display SHALL use display number 765 when it is free. When that number belongs to a display Terminay does not own, the server SHALL use another free number, report it in status, and leave the other display untouched.

#### Scenario: Machine already runs a VNC session

- **WHEN** the server account already has a VNC session and configuration of its own and the server desktop starts
- **THEN** that session keeps running unchanged, its configuration is neither read nor written, and the server desktop runs as a separate display

#### Scenario: Display number taken

- **WHEN** display 765 belongs to a process Terminay did not start
- **THEN** the desktop starts on another free display number, status reports that number, and the other display is not affected

### Requirement: The desktop is reachable only through Terminay

A client SHALL receive the desktop only through the Terminay connection. Nothing outside that connection SHALL be able to view or control it from the network:

- The display server and the desktop session SHALL NOT listen on any TCP or UDP port, for X11, for remote framebuffer traffic, or for any helper service.
- The remote framebuffer listener SHALL be a unix socket with owner-only permissions inside an owner-only directory, and the server SHALL be its only client.
- The X11 socket and its lock file SHALL be at the display's conventional paths, because programs find the display there. X11 clients SHALL be admitted only with the desktop's authority cookie.
- The cookie SHALL be readable only by the server account and SHALL never appear in process arguments, logs, diagnostics, or protocol messages.
- Every other file the desktop uses SHALL live in owner-only directories Terminay owns.
- The display server SHALL run without the ability to open a network connection, so it cannot be made to send the screen to another host.
- No Terminay operation SHALL return the cookie, a socket's path, or any address another program could connect to.

#### Scenario: Port scan

- **WHEN** the desktop is `ready` and every TCP and UDP listener on the host is listed
- **THEN** none belongs to the display server, the desktop session, or any process they started

#### Scenario: Another account

- **WHEN** a process of a different, unprivileged account tries to open the display or the framebuffer socket
- **THEN** it is refused

#### Scenario: Remote client

- **WHEN** a paired remote browser client opens the desktop
- **THEN** it is shown through the Terminay connection and no additional port on the server is reachable from that device

#### Scenario: Requested reverse connection

- **WHEN** a program on the display asks the display server to connect out to another host
- **THEN** no connection is made, and programs on the display keep their own network access

### Requirement: Any client in Terminay may use the desktop

Pairing is the trust point: a client that holds a Terminay connection with write authority can already run programs as the server account. Desktop operations SHALL therefore be available to every such connection, and to no other. A connection narrowed to a project, terminal session, capability, chat, or MCP principal SHALL be refused as forbidden, and the refusal SHALL NOT reveal the desktop's state.

The desktop is shared by every project on the server: any program the server account runs can draw on it, read it, and type into it, and every viewer sees all of it. Every place that shows the desktop SHALL offer a way to read that.

Each desktop stream SHALL be bound to the authorized client connection, the mode, and a stream generation. The server SHALL revalidate that authority on every read and write, and SHALL close the stream when the connection ends or its device is revoked.

#### Scenario: Paired device

- **WHEN** a paired remote device with an ordinary Terminay connection opens the desktop
- **THEN** the desktop is shown

#### Scenario: Narrowed connection

- **WHEN** a connection whose authority is narrowed to one project or one terminal session asks for desktop status or a desktop stream
- **THEN** it is refused as forbidden

#### Scenario: MCP principal

- **WHEN** an MCP principal asks to open the desktop
- **THEN** it is refused as forbidden

#### Scenario: Device revoked while viewing

- **WHEN** a device is revoked while it shows the desktop
- **THEN** its desktop stream closes and it receives no further frames

### Requirement: One client controls the desktop at a time

A desktop stream SHALL be either view-only or control. At most one control stream SHALL exist. Opening the desktop SHALL grant control when no client holds it and view-only otherwise. A viewer SHALL be able to take control, which SHALL end the previous controller's control stream and leave that client viewing, told which device took control by a `server.desktop.control` event sent to every connection showing the desktop. Requests to take control SHALL be applied one at a time, and each SHALL complete only after the previous control stream has ended.

In view-only mode the server SHALL discard every keyboard, pointer, clipboard, and resize message. Each stream SHALL have its own connection to the display server, opened with a credential for its mode, so the display server itself refuses a view-only stream's input. When a control stream ends for any reason, including a failure of that stream, no key or pointer button it was holding SHALL remain held when input from any other stream reaches the desktop.

#### Scenario: Second device opens the desktop

- **WHEN** a second device opens the desktop while the first holds control
- **THEN** the second device sees the desktop view-only and the first keeps control

#### Scenario: Taking control

- **WHEN** the second device takes control
- **THEN** its input reaches the desktop, the first device's input no longer does, and the first device is told which device took control

#### Scenario: Simultaneous takeovers

- **WHEN** two viewers take control at the same moment
- **THEN** exactly one holds control afterwards and the other is view-only

#### Scenario: Controller drops while a key is held

- **WHEN** the controller's connection fails while it is holding Shift and a pointer button
- **THEN** neither is held on the desktop when the next controller's first input arrives

#### Scenario: Forged input in view-only mode

- **WHEN** a view-only client sends a pointer event over its desktop stream
- **THEN** the server discards it and the desktop receives no input

### Requirement: Desktop traffic is filtered by the server

The server SHALL forward only a bounded allowlist of client messages and SHALL close the stream on any unknown, malformed, or oversized message. The server SHALL authenticate to the display server itself, so a client never holds a credential for it.

#### Scenario: Malformed traffic

- **WHEN** a client sends an unknown remote framebuffer message type or an oversized clipboard message
- **THEN** the server closes that desktop stream and the desktop receives nothing

### Requirement: The desktop follows its window's size

While a client holds control, resizing the desktop tab in use SHALL resize the desktop to fit, as a single screen between 640 by 480 and 3840 by 2160 pixels. A request outside those bounds SHALL be clamped. A request that names more than one screen or is otherwise malformed SHALL close the stream. The server SHALL apply at most ten resizes per second from a stream and SHALL apply the latest request it received. A view-only client SHALL scale the desktop to fit its window and SHALL NOT resize it.

#### Scenario: Controller resizes

- **WHEN** the desktop tab in use on the controlling client is resized to 1600 by 900
- **THEN** the desktop becomes 1600 by 900 and maximised programs fill it

#### Scenario: Oversized request

- **WHEN** a control stream asks for a desktop of 20000 by 20000 pixels
- **THEN** the desktop is no larger than 3840 by 2160

#### Scenario: Malformed layout

- **WHEN** a control stream sends a resize naming two screens
- **THEN** the server closes that stream and the desktop keeps its size

#### Scenario: Viewer resizes

- **WHEN** a view-only client resizes its window
- **THEN** the desktop keeps its size and that client's view is scaled to fit

### Requirement: The desktop in tabs

Opening the desktop in a tab SHALL add a desktop tab to whatever the window is showing: the selected folder of the project in front, or Home. A window MAY hold any number of desktop tabs, in any of its projects and in Home. A desktop tab SHALL behave as the other tabs of the place it is in: it can be dragged, split, and closed there. A desktop tab SHALL offer to move to Home or to any other project of the same server, and moving it SHALL close it where it was and open it there. Desktop tabs SHALL be remembered by the device that opened them and SHALL come back in the same places after the window reloads; the server SHALL NOT record them.

A desktop tab SHALL show the mode, a way to take or give up control, how the clipboard is shared, and, in a menu, the display number, a reconnect action, and turning the desktop off. While the desktop is not `ready`, a desktop tab SHALL show the same state the dropdown shows. Losing the stream SHALL show a reconnecting state in every place that shows the desktop and SHALL NOT close any of them.

A client window SHALL hold at most one desktop stream, however many places show the desktop. Input, the clipboard, and the desktop's size SHALL follow the desktop tab that was focused most recently and is on screen; every other place SHALL show a copy of that stream's picture, updated only while that place is on screen. Activating a place that shows a copy SHALL make it the one in use. While no desktop tab is on screen, the stream SHALL keep the desktop's size.

#### Scenario: Opening in a tab

- **WHEN** a user chooses to open the desktop in a tab while a project is in front
- **THEN** a desktop tab opens among that project folder's tabs, and the dropdown closes

#### Scenario: Several tabs, one stream

- **WHEN** a user opens the desktop in two tabs of the same window
- **THEN** the window holds one desktop stream, the tab focused last receives input, and the other shows the same picture

#### Scenario: Using another tab

- **WHEN** a user activates the desktop tab that shows a copy
- **THEN** that tab receives input and the desktop takes its size

#### Scenario: Moving a tab

- **WHEN** a user moves a desktop tab from a project to Home
- **THEN** the tab closes in the project and opens in Home

#### Scenario: Reload

- **WHEN** the window reloads with desktop tabs open in a project and in Home
- **THEN** the same desktop tabs are open in the same places

#### Scenario: Glancing does not resize

- **WHEN** a user opens the dropdown while no desktop tab is on screen
- **THEN** the desktop keeps its size

#### Scenario: Stream lost

- **WHEN** the connection drops while the desktop is shown
- **THEN** every place showing it says it is reconnecting and shows the desktop again once the connection returns

### Requirement: The clipboard is shared only with the controlling host

A host SHALL keep its clipboard text synchronized with the server desktop only while it holds control of that desktop and a place showing the desktop is connected and visible. Sharing SHALL follow the same direction, ordering, paste-chord, size, text-only, selection, and browser-host rules as the bot desktop, and a host SHALL share with at most one desktop of any kind at a time.

A view-only stream SHALL carry no clipboard content in either direction. The server SHALL enforce that on the bytes of the stream itself, for every clipboard message form, and SHALL NOT rely on the client to ignore them. Clipboard contents SHALL NOT be persisted or logged.

#### Scenario: Copy on the host, paste on the desktop

- **WHEN** the controlling user copies text on their host and pastes into a program on the server desktop
- **THEN** the pasted text is the copied text

#### Scenario: Viewer's stream

- **WHEN** text is copied on the server desktop while a client is viewing without control
- **THEN** the bytes delivered to that client contain no clipboard message

#### Scenario: Control taken

- **WHEN** another device takes control
- **THEN** the previous controller's clipboard sharing ends and later desktop copies do not reach it

### Requirement: The desktop session

The desktop SHALL run a window manager, a panel with an applications menu and a list of open windows, and a terminal launcher, using the same session configuration as the bot desktop. A program started on the display SHALL run as the server account with that account's own home and files. Setup SHALL NOT install a browser or any application beyond the desktop session itself.

#### Scenario: Running a graphical program

- **WHEN** a user runs a graphical program from a terminal that has the desktop's display environment
- **THEN** its window appears on the desktop with a title bar and appears in the panel's window list

#### Scenario: Two programs

- **WHEN** two graphical programs are open
- **THEN** the user can switch between them from the panel and move, resize, and close each window

### Requirement: The desktop outlives a server restart

While it is set up and turned on, the desktop SHALL run whenever the server runs, so a terminal's display environment always names a live display. Restarting the server process SHALL leave the display server, the session, and the programs on it running, and the restarted server SHALL adopt them without starting a second display. An upgrade SHALL do the same when the new release can speak to the running desktop's supervisor; otherwise it SHALL restart the desktop and report the interruption. The display number and authority cookie SHALL stay the same across restarts. The server SHALL adopt only a supervisor that completes a credential handshake with a secret only the server account can read; a process id or path recorded on disk SHALL NOT be sufficient. At most one supervisor SHALL exist.

When the display server exits unexpectedly, the server SHALL start it again with the same display number and cookie, report the interruption, and close open desktop streams so clients reconnect. Replacing or stopping the server's container ends the desktop. When the server next starts it SHALL start the desktop again if the required programs are present, and report `needs-setup` otherwise.

#### Scenario: Server restart

- **WHEN** the server process restarts while a graphical program is open on the desktop
- **THEN** the program keeps running, and a client that reopens the desktop sees it

#### Scenario: Shell opened before the restart

- **WHEN** a terminal opened before a server restart runs a graphical program after it
- **THEN** the program's window appears on the desktop

#### Scenario: Display server crash

- **WHEN** the display server exits unexpectedly
- **THEN** the server starts it again on the same display number, status reports the interruption, and every place showing the desktop reconnects

#### Scenario: Upgrade to a compatible release

- **WHEN** the server is upgraded to a release that can speak to the running supervisor while a graphical program is open
- **THEN** the program keeps running and the upgraded server shows it

#### Scenario: Upgrade to an incompatible release

- **WHEN** the server is upgraded to a release that cannot speak to the running supervisor
- **THEN** the desktop is restarted on the same display number and status reports the interruption

#### Scenario: Container recreated

- **WHEN** the server's container is recreated from an image without the display server
- **THEN** the state is `needs-setup`

#### Scenario: Planted record

- **WHEN** a file in the desktop's state directory names a process the server did not start
- **THEN** the server does not adopt, signal, or connect to that process

### Requirement: Turning the desktop off

`server.desktop.disable` and `server.desktop.enable` SHALL turn the desktop off and on. They SHALL require desktop authority, and the generic settings operations SHALL NOT be able to change or reveal the desktop's state. Turning the desktop off SHALL end the session and the display server, which closes every window on the display, including those of programs started from terminals, and SHALL require confirmation when a program window is open. While the desktop is off, setup completing SHALL NOT start it.

#### Scenario: Turning the desktop off

- **WHEN** a user turns the desktop off while a program window is open and confirms
- **THEN** the session and the display server end, no window remains, the state is `off`, and new terminals receive no display environment

#### Scenario: Generic settings write

- **WHEN** a client tries to change the desktop's on or off state through a generic settings operation
- **THEN** the state does not change

#### Scenario: Setup while off

- **WHEN** setup completes on a server whose desktop has been turned off
- **THEN** the state is `off` and no desktop process is started
