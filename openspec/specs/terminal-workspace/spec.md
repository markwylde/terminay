# terminal-workspace Specification

## Purpose

Terminay provides terminal sessions inside the project workspace, where Terminay Server creates and owns each session through the exact project's environment and Xterm renders it in a client panel that forwards input, resize, and lifecycle commands through the application protocol.

## Requirements

### Requirement: Server-owned terminal sessions

Terminay Server SHALL create and own each terminal session through the exact project's environment: This server uses a native PTY, while providers MAY control a remote PTY. Xterm SHALL be a client renderer that forwards input, resize, and lifecycle commands through the application protocol. Terminay Server SHALL own PTY creation, output replay, input, resize, activity, and termination. A PTY SHALL survive browser reload, transport loss, and Electron-window close while its server remains alive. Local and remote clients SHALL use the same terminal command and stream contract, differing only in transport.

#### Scenario: Client goes away

- **WHEN** a browser reloads, a transport is lost, or an Electron window is closed
- **THEN** the server-owned PTY continues running while its server remains alive

#### Scenario: Remote client

- **WHEN** a remote client operates a terminal
- **THEN** it uses the same terminal command and stream contract as a local client, differing only in the underlying transport

### Requirement: Canonical shell and working-directory resolution

New sessions SHALL resolve a server-owned shell profile and working directory through the canonical shell profiles and terminal launch policy. Startup, new-project, new-tab, split, local, and remote creation SHALL NOT maintain separate shell or cwd fallbacks. System-default resolution SHALL happen in the exact project environment that will own the PTY, and Desktop and browser clients SHALL NOT supply their host shell as a fallback.

#### Scenario: Any creation route

- **WHEN** a terminal is created from startup, a new project, a new tab, a split, or a local or remote client
- **THEN** the same profile and cwd are resolved for the same server, project, active panel, and explicit user choices

#### Scenario: System default shell

- **WHEN** the system default shell is resolved
- **THEN** resolution happens in the exact project environment that will own the PTY
- **AND** the client host's own shell is not used as a fallback

### Requirement: Protected emulator environment

Every resolved Terminay PTY SHALL advertise the emulator it actually runs under with `TERM=xterm-256color` and `COLORTERM=truecolor`. Host launcher values such as `TERM=dumb` SHALL NOT cross into a terminal session, and profiles SHALL NOT weaken these protected emulator capabilities.

#### Scenario: Host launcher sets TERM=dumb

- **WHEN** the host launcher environment contains `TERM=dumb`
- **THEN** the terminal session still advertises `TERM=xterm-256color` and `COLORTERM=truecolor`

#### Scenario: Profile attempts to weaken TERM

- **WHEN** a shell profile sets a weaker `TERM` or `COLORTERM`
- **THEN** the protected emulator capabilities are preserved

### Requirement: Core terminal interactions

Terminals SHALL support splits, search, copy and paste including bracketed-paste-aware input, dropped paths, guarded external links, resizing, scrollback, zoom, and exit handling.

#### Scenario: Interactive use

- **WHEN** a user splits, searches, copies, pastes, resizes, scrolls back, zooms, or exits a terminal
- **THEN** each of those interactions is supported by the terminal panel

### Requirement: Chunked clipboard paste with visible progress

Clipboard text that exceeds one terminal-input frame SHALL be sent in ordered, bounded chunks. The terminal SHALL advance the paste one delivered chunk per render frame so its compact indicator reports the actual delivered-byte percentage for the whole transfer, and SHALL NOT complete merely because the browser or transport has buffered the remainder. The indicator SHALL include a Stop control that prevents unsent clipboard chunks from reaching the PTY while leaving bytes already accepted by the transport untouched.

#### Scenario: Large paste

- **WHEN** pasted clipboard text exceeds one terminal-input frame
- **THEN** it is sent in ordered bounded chunks, one delivered chunk per render frame
- **AND** the indicator reports the actual delivered-byte percentage and does not complete on transport buffering alone

#### Scenario: Stopping a paste

- **WHEN** the user activates the paste indicator's Stop control
- **THEN** unsent clipboard chunks do not reach the PTY
- **AND** bytes already accepted by the transport are left untouched

### Requirement: Desktop clipboard preference order

On Desktop, a user-initiated terminal paste SHALL prefer copied file paths, then text, then convert an image-only clipboard item into a PNG in Terminay's temporary clipboard directory and insert its shell-escaped path. Clipboard images and their temporary paths SHALL be read and created only by Electron. Browser clients SHALL retain their ordinary exact-origin text paste.

#### Scenario: Image-only clipboard on Desktop

- **WHEN** a Desktop user pastes with only an image on the clipboard
- **THEN** Electron writes a PNG into Terminay's temporary clipboard directory and inserts its shell-escaped path

#### Scenario: Browser paste

- **WHEN** a browser client pastes into a terminal
- **THEN** it performs its ordinary exact-origin text paste and receives no local temporary path

### Requirement: Terminal zoom scope

Desktop Zoom In, Zoom Out, and Reset Zoom SHALL change the terminal font size only and SHALL publish a `terminal.zoom` host event. They SHALL NOT zoom the surrounding UI.

#### Scenario: Zoom invoked

- **WHEN** the user invokes Desktop Zoom In, Zoom Out, or Reset Zoom
- **THEN** the terminal font size changes and a `terminal.zoom` host event is published
- **AND** the surrounding UI is not zoomed

### Requirement: Renderer selection for xterm surfaces

Live xterm surfaces SHALL use the WebGL renderer when the host provides WebGL2 so box-drawing and block glyphs fill the cell. Missing WebGL, a lost GPU context, or an automated driver session SHALL fall back to the DOM renderer without changing PTY behaviour. Server-side headless xterm SHALL NOT load a GPU renderer. Recording replay SHALL stay on the DOM renderer. Replay list, play, zoom, and palette chrome SHALL stay mounted if the replay canvas fails to open. Live surfaces SHALL pin the xterm 6.1 WebGL addon so split panes that share a glyph atlas rebuild after atlas page merges instead of painting stale glyphs. Custom box-drawing glyphs SHALL be a WebGL addon option rather than a core xterm option.

#### Scenario: No WebGL2 available

- **WHEN** the host lacks WebGL2, loses its GPU context, or runs under an automated driver session
- **THEN** the surface falls back to the DOM renderer
- **AND** PTY behaviour is unchanged

#### Scenario: Split panes sharing a glyph atlas

- **WHEN** split panes share a glyph atlas and atlas pages merge
- **THEN** the panes rebuild rather than painting stale glyphs

#### Scenario: Replay canvas fails

- **WHEN** the recording replay canvas fails to open
- **THEN** the replay list, play, zoom, and palette chrome stay mounted

### Requirement: Touch input and software keyboard accessory

On touch devices, xterm SHALL own scrollback and the terminal mouse and key sequences required by interactive TUIs; Terminay SHALL NOT translate or suppress touch input over the xterm surface. A synchronous, non-cancelling touch focus bridge SHALL focus xterm's helper textarea so iOS can present its software keyboard, and that bridge SHALL claim focus only for a tap — a touch that is released without travelling beyond a small movement threshold. A touch that scrolls, drags, or is cancelled SHALL NOT focus the terminal and SHALL NOT cause a software keyboard to be presented. While that keyboard is visible, Terminay SHALL present a compact accessory row immediately above it for Escape, Tab, one-shot Control, Shift, and Alt modifiers, arrow keys, Enter, Paste, and keyboard dismissal. The accessory SHALL send its bytes through the terminal panel's normal input boundary and SHALL NOT implement scrolling or gesture translation.

#### Scenario: Touching the terminal on iOS

- **WHEN** a user touches the xterm surface on a touch device and releases without moving beyond the movement threshold
- **THEN** a synchronous, non-cancelling focus bridge focuses xterm's helper textarea so the software keyboard appears
- **AND** touch input over the surface is neither translated nor suppressed

#### Scenario: Scrolling the terminal does not raise the keyboard

- **WHEN** a user touches the xterm surface, moves beyond the movement threshold, and releases
- **THEN** the terminal is not focused and no software keyboard is presented
- **AND** xterm scrolls the buffer for that gesture as it would for any other touch pan

#### Scenario: Cancelled touch claims nothing

- **WHEN** a touch over the xterm surface is cancelled before it is released
- **THEN** the terminal is not focused and no software keyboard is presented

#### Scenario: Scrolling an already-focused terminal keeps it focused

- **WHEN** the terminal already holds focus and the user scrolls it by touch
- **THEN** the terminal remains focused
- **AND** a software keyboard that was already visible is not dismissed

#### Scenario: Focus is claimed on release, within the activating gesture

- **WHEN** the focus bridge claims focus for a tap
- **THEN** it does so while the releasing touch event is still in flight, so a platform that gates software-keyboard presentation on a trusted user gesture still presents one

#### Scenario: Accessory row in use

- **WHEN** the software keyboard is visible and the user activates an accessory control
- **THEN** its bytes are sent through the terminal panel's normal input boundary
- **AND** the accessory implements no scrolling or gesture translation


### Requirement: File drop behaviour

Dropping operating-system files onto a Desktop terminal SHALL insert their native paths without copying the files. Dropping browser-local files onto a web terminal SHALL upload bounded file contents into the selected server project's root and insert the resulting server paths. Browser clients SHALL NOT receive or infer a local absolute path.

#### Scenario: Desktop file drop

- **WHEN** operating-system files are dropped onto a Desktop terminal
- **THEN** their native paths are inserted and the files are not copied

#### Scenario: Browser file drop

- **WHEN** browser-local files are dropped onto a web terminal
- **THEN** bounded file contents are uploaded into the selected server project's root and the resulting server paths are inserted
- **AND** the browser client receives no local absolute path

### Requirement: Tab identity, styling, and actions

A tab SHALL be renameable and styleable with colour, emoji, terminal-theme controls, and an optional note. Double-clicking the tab or long-pressing it SHALL open that editor. Tab context actions SHALL expose terminal-specific actions such as recording and moving the tab to another project.

#### Scenario: Opening the tab editor

- **WHEN** the user double-clicks or long-presses a terminal tab
- **THEN** the editor opens with rename, colour, emoji, terminal-theme controls, and an optional note

#### Scenario: Tab context menu

- **WHEN** the user opens a terminal tab's context actions
- **THEN** terminal-specific actions such as recording and moving to another project are available

### Requirement: Command Bar terminal targeting

The Command Bar SHALL expose terminal and workspace actions. A terminal command SHALL report an inline failure rather than silently targeting a different panel.

#### Scenario: No valid terminal target

- **WHEN** a Command Bar terminal action has no valid terminal target
- **THEN** it reports an inline failure
- **AND** it does not target a different panel

### Requirement: Output fan-out to integrations

PTY output SHALL fan out in Terminay Server to authorized clients and to recording, activity, and agent integrations. These consumers SHALL NOT change the terminal stream.

#### Scenario: Recording and agents attached

- **WHEN** recording, activity, and agent integrations consume a session's PTY output
- **THEN** the terminal stream delivered to authorized clients is unchanged

### Requirement: Provider-governed process observation

Provider capabilities SHALL govern current-directory and foreground-process observation. Missing observation SHALL be an explicit limited state and SHALL NOT inspect a similarly named process on the Terminay Server host.

#### Scenario: Provider lacks observation

- **WHEN** a project's environment does not provide current-directory or foreground-process observation
- **THEN** an explicit limited state is shown
- **AND** no similarly named process on the Terminay Server host is inspected

### Requirement: Terminal link and input safety

Terminal content SHALL be treated as untrusted text. Modifier-clicking a detected or OSC-8 HTTP or HTTPS link SHALL open that credential-free URL in the system browser; other schemes and URLs with credentials SHALL be rejected. Paste and external drop behaviour SHALL remain user initiated. Screen-reader and reduced-motion settings SHALL be honoured. Secrets typed in a terminal SHALL NOT be collected by default; recording has its own explicit policy.

#### Scenario: Modifier-clicking a link

- **WHEN** a user modifier-clicks a detected `http://` or `https://` terminal link, including an OSC-8 hyperlink
- **THEN** that credential-free URL opens in the system browser

#### Scenario: Unsafe link

- **WHEN** a terminal link uses another scheme or contains credentials
- **THEN** opening it is rejected

### Requirement: Terminal authorization boundary

The server terminal boundary SHALL use immutable `{serverId, projectId, sessionId}` identity. Input SHALL be accepted only for that exact live session and SHALL be bounded by the negotiated input-byte limit; resize and termination SHALL use the same authorization boundary. The server SHALL also verify that the session's stored environment equals its canonical project. Clients SHALL NOT choose the terminal adapter with an environment id.

#### Scenario: Input for another session

- **WHEN** input, resize, or termination is addressed to a session other than the exact live authorized one
- **THEN** it is rejected

#### Scenario: Client supplies an environment id

- **WHEN** a client supplies an environment id with a terminal command
- **THEN** it cannot choose the terminal adapter
- **AND** the server verifies the session's stored environment equals its canonical project

### Requirement: Bounded output framing and replay window

Terminal output SHALL be counted in raw bytes, split into bounded frames, and retained in a bounded replay window with a monotonically increasing byte position. A reconnect from a position older than the retained window SHALL receive an explicit resync or gap result rather than guessed or duplicate output. Queued output SHALL be bounded per subscriber, and a slow consumer SHALL be detached without terminating the server-owned PTY.

#### Scenario: Reconnect from a stale position

- **WHEN** a client reconnects from a byte position older than the retained replay window
- **THEN** it receives an explicit resync or gap result
- **AND** no guessed or duplicate output is delivered

#### Scenario: Slow consumer

- **WHEN** one subscriber's queued output exceeds its bound
- **THEN** that subscriber is detached
- **AND** the server-owned PTY is not terminated

### Requirement: Exit and interruption metadata

Exit metadata — code, signal, reason, and timestamp — SHALL be committed and published once, and the canonical workspace session record SHALL be marked exited so a later attach or renderer reload cannot treat that panel as a live PTY. Server shutdown or restart SHALL mark live sessions interrupted once, while client disconnect, reload, and native-window close SHALL NOT alter session lifetime.

#### Scenario: Terminal exits

- **WHEN** a PTY exits
- **THEN** its code, signal, reason, and timestamp are committed and published once and the session record is marked exited
- **AND** a later attach or renderer reload does not treat that panel as a live PTY

#### Scenario: Closing an exited terminal

- **WHEN** an exited terminal is closed
- **THEN** its panel is removed without recovering the shared application connection or reloading the renderer
- **AND** sibling live terminals stay attached and interactive

#### Scenario: Server restart

- **WHEN** the server shuts down or restarts
- **THEN** live sessions are marked interrupted once

### Requirement: Binary live output framing

Live terminal output SHALL use the protocol frame's binary body. Its event envelope SHALL contain only attachment-scoped identity, byte positions, and output metadata, and the body length SHALL exactly equal `nextPosition - position`. The server MAY coalesce adjacent PTY callbacks into one bounded contiguous body before framing, but SHALL NOT reorder, drop, or split an ANSI sequence by inventing a byte position. A client SHALL advertise `terminal.binary-output` before receiving binary event bodies, and a compatible server SHALL retain the base64 event field only for clients that do not advertise that capability. Attach-result replay SHALL remain base64 because command-result events have no binary body.

#### Scenario: Client advertises binary output

- **WHEN** a client advertises `terminal.binary-output`
- **THEN** live output arrives in the protocol frame's binary body with a body length exactly equal to `nextPosition - position`

#### Scenario: Client without the capability

- **WHEN** a client does not advertise `terminal.binary-output`
- **THEN** the server retains the base64 event field for that client

#### Scenario: Coalescing callbacks

- **WHEN** the server coalesces adjacent PTY callbacks
- **THEN** the resulting body is bounded and contiguous
- **AND** no output is reordered or dropped and no ANSI sequence is split by an invented byte position

### Requirement: Transport-neutral attach and detach boundary

The transport-neutral `TerminalServiceAdapter` SHALL supply the attach, detach, and resume boundary used by local and remote protocol adapters. It SHALL keep a bounded per-client and per-session high-water mark, advance a stale reconnect cursor before asking the server for replay, and suppress output at or below the last delivered position. Detaching SHALL close only that client subscription while the PTY and its replay window remain owned by the server.

#### Scenario: Stale reconnect cursor

- **WHEN** a client reconnects with a cursor behind its last delivered position
- **THEN** the cursor is advanced before replay is requested
- **AND** output at or below the last delivered position is suppressed

#### Scenario: Detach

- **WHEN** a client detaches
- **THEN** only that client's subscription closes
- **AND** the PTY and its replay window remain owned by the server

### Requirement: Client terminal command surface

`TerminayTerminalClient` SHALL expose the same boundary over a canonical client command and subscription transport. A write-authorized client SHALL create a new server-owned session through `terminal.create`, and the server SHALL assign its session identity and return its canonical cwd and dimensions. The client SHALL then use `terminal.attach`, `terminal.resume`, `terminal.detach`, and `terminal.ack`, subscribe to the bounded `terminal` stream, decode raw output bytes, and reject events whose immutable identity does not match the requested session. Client and session high-water marks SHALL survive a detach, and stale resume cursors SHALL NOT deliver duplicate output. Local sockets, browser transports, and WebRTC SHALL only provide the underlying command and event transport and SHALL NOT own the PTY.

#### Scenario: Creating a session

- **WHEN** a write-authorized client issues `terminal.create`
- **THEN** the server assigns the session identity and returns its canonical cwd and dimensions

#### Scenario: Mismatched event identity

- **WHEN** an event's immutable identity does not match the requested session
- **THEN** the client rejects that event

### Requirement: Subscription established before attach

The client SHALL establish an identity-scoped terminal subscription before it issues `terminal.attach` or `terminal.resume`, then accept events only for the opaque attachment identity returned by that command. It SHALL buffer this bounded handoff until the command result and any authoritative checkpoint are applied. This ordering SHALL NOT relax strict contiguous-position validation.

#### Scenario: Shell writes immediately after spawn

- **WHEN** a newly spawned shell writes after the server allocates its attachment but before the attach command result is applied
- **THEN** the pre-established subscription buffers that bounded handoff until the result and any authoritative checkpoint are applied
- **AND** strict contiguous-position validation still applies

### Requirement: Bounded command-result replay

Initial attach and resume replay SHALL be capped independently of the retained server window so its base64 command-result representation always fits the default protocol header budget. The server SHALL enforce the cap even when a client omits or overstates its requested replay budget, and SHALL coalesce contiguous replay chunks so per-event metadata does not exhaust that budget. Live output SHALL continue on the ordered terminal event stream after attachment.

#### Scenario: Client overstates its replay budget

- **WHEN** a client omits or overstates its requested replay budget
- **THEN** the server enforces the cap and coalesces contiguous replay chunks
- **AND** live output continues on the ordered terminal event stream after attachment

### Requirement: Replay cap is not a lifetime limit

The command-result replay cap SHALL NOT act as a terminal-lifetime or presentation-size limit. A fresh display SHALL hydrate through a bounded binary checkpoint transfer and SHALL NOT require the complete raw transcript to fit in a command header. Presentation-unavailable SHALL be reserved for a missing, invalid, or resource-exhausted authoritative checkpoint, not for an otherwise healthy terminal whose lifetime output exceeds an attach-header budget.

#### Scenario: Long-running high-output terminal

- **WHEN** a terminal's lifetime output greatly exceeds the attach-header budget and the raw replay window has advanced
- **THEN** a fresh display still hydrates through a bounded binary checkpoint transfer
- **AND** the terminal is not reported presentation-unavailable

### Requirement: Attach begins at a valid presentation boundary

An attach or resync SHALL begin from a valid terminal presentation boundary. The server SHALL NOT ask a fresh emulator to reconstruct a screen from an arbitrary byte suffix that may begin inside an escape sequence or depend on discarded terminal mode history. A bounded checkpoint or equivalent canonical screen state SHALL be tied to an exact output position, and live raw bytes SHALL continue from that position without a gap or duplicate. If no valid boundary is retained, the client SHALL receive an explicit unavailable or resync state instead of a plausible but corrupted terminal display.

#### Scenario: Fresh client or recovery after a gap

- **WHEN** a fresh client attaches, or a client recovers after a replay gap
- **THEN** it hydrates from a valid presentation boundary and then receives uninterrupted live output
- **AND** it never starts inside a partial ANSI or OSC sequence

#### Scenario: No valid boundary retained

- **WHEN** no valid presentation boundary is retained
- **THEN** the client receives an explicit unavailable or resync state

### Requirement: Checkpoint hydration authorization

Checkpoint hydration SHALL be authorized by an immutable, one-use pin bound during attach to the exact server, project, session, client, and attachment. A mutable live-attachment registry SHALL NOT be a second authority for that binary handoff. The pin SHALL remain scoped and unguessable, and replacement SHALL release stale pins.

#### Scenario: Registry changes while a query is in flight

- **WHEN** rapid panel replacement or moving a terminal presentation between projects changes the live attachment registry while a bound checkpoint query is in flight
- **THEN** authorization still follows the immutable one-use pin bound at attach
- **AND** replacement releases stale pins

### Requirement: Layout changes preserve terminal presentation

Workspace metadata and chrome SHALL NOT be terminal presentation lifecycles. Changing a project root, opening or closing a sidebar, resizing a window, and other layout-only updates SHALL preserve the mounted emulator, its attachment, and its rendered byte position. A surviving emulator SHALL resume from its exact acknowledged position after transient transport loss. Only a genuinely new emulator, such as one created after renderer reload or window restoration, SHALL request checkpoint hydration.

#### Scenario: Sidebar toggled or window resized

- **WHEN** a project root changes, a sidebar opens or closes, or a window is resized
- **THEN** the mounted emulator, its attachment, and its rendered byte position are preserved

#### Scenario: Transient transport loss

- **WHEN** a surviving emulator reconnects after transient transport loss
- **THEN** it resumes from its exact acknowledged position without duplicating the PTY or replaying acknowledged output

### Requirement: Transport-neutral panel client

`TerminayTerminalPanelClient` SHALL be the transport-neutral view over an attachment, exposing raw-byte output, exit and resync notifications, and attachment-scoped input, resize, kill, and acknowledgement commands. It SHALL have no Electron or Node dependency so a shared panel uses it identically in Desktop and browser hosts.

#### Scenario: Shared panel in either host

- **WHEN** the shared terminal panel runs in a Desktop host or a browser host
- **THEN** it uses the same panel client with no Electron or Node dependency

### Requirement: Terminal creation is a server-owned workspace mutation

The production shared Terminal route body SHALL be project-scoped from the current server-owned workspace snapshot. Creating a terminal SHALL be a server-owned workspace mutation: the server creates the PTY session and the corresponding terminal panel record, commits both under the next workspace revision, and publishes the ordered workspace event consumed by every connected client. The event SHALL accelerate reconciliation but SHALL NOT be an acknowledgement: after the create command returns, the initiating client SHALL actively read the authoritative delta and complete only when one atomic projection contains both the returned session and its terminal panel.

#### Scenario: Change notification lost

- **WHEN** the workspace change notification is lost during transport replacement
- **THEN** the initiating client still completes by actively reading the authoritative delta
- **AND** it completes only when one atomic projection contains both the returned session and its terminal panel

### Requirement: Renderer does not invent terminal panel identity

Renderer code SHALL NOT create durable terminal panel identity as a fallback for missing server state. It MAY only mount the xterm body for a server-owned panel, attach through `TerminayTerminalPanelClient`, and keep temporary local measurements that are either discarded or committed through explicit workspace commands.

#### Scenario: Server panel record missing

- **WHEN** a renderer lacks a server-owned terminal panel record
- **THEN** it does not create durable panel identity locally

### Requirement: Hydration presentation for an inactive tab

Because only the active terminal body is mounted, a newly created terminal SHALL NOT complete xterm hydration while its tab remains inactive. While hydration is in progress, the terminal tab SHALL use a small rotating loader in its icon position and the terminal body SHALL remain an undecorated empty terminal surface; it SHALL NOT show a centered Terminay mark or loading copy. The loader SHALL be removed when hydration completes, and an attachment failure SHALL replace the blank state with the actionable terminal error presentation.

#### Scenario: Newly created terminal hydrating

- **WHEN** a newly created terminal is hydrating
- **THEN** its tab shows a small rotating loader in the icon position and its body is an undecorated empty terminal surface
- **AND** no centered Terminay mark or loading copy is shown

#### Scenario: Attachment fails during hydration

- **WHEN** attachment fails while the terminal shows its blank hydration state
- **THEN** the actionable terminal error presentation replaces that blank state

### Requirement: Checkpoint restore then fit

A newly mounted terminal SHALL restore its checkpoint at the checkpoint's original grid, then fit to the active panel's non-zero viewport before hydration becomes visible and before it claims the current viewport dimensions from the PTY. A saved checkpoint grid SHALL NOT leave a newly activated terminal visibly narrow when its active panel is wider.

#### Scenario: Checkpoint narrower than the panel

- **WHEN** a saved checkpoint grid is narrower than the active panel's viewport
- **THEN** the terminal fits to the panel's non-zero viewport before hydration becomes visible
- **AND** it is not left visibly narrow

### Requirement: Server-side input write boundary

`TerminalInputSourceAdapter` SHALL be the server-side write boundary for keyboard, paste, macro, dictation, MCP, and remote sources. It SHALL validate the exact server, project, and session authorization, preserve per-session write ordering, track optional per-source sequence numbers, and apply bounded input backpressure before forwarding bytes to the PTY.

#### Scenario: Concurrent input sources

- **WHEN** keyboard, macro, dictation, MCP, and remote input arrive for one session
- **THEN** per-session write ordering is preserved and bounded input backpressure is applied before bytes reach the PTY

#### Scenario: Input reaching only its own PTY

- **WHEN** input or resize is submitted for a session
- **THEN** it reaches only that intended live PTY

### Requirement: Viewport dimension lease

Viewport changes SHALL use an explicit lease: one client claims `wide`, `narrow`, or `mobile` dimensions, the owner updates or releases them, and an expired or disconnected owner SHALL NOT continue to block another client from claiming the session.

#### Scenario: Owner disconnects

- **WHEN** the viewport-dimension owner disconnects or its lease expires
- **THEN** another client can claim the session's dimensions

### Requirement: Interactive presentation lease

Each live session SHALL have one interactive presentation lease shared by keyboard and paste input, viewport ownership, and emulator-generated protocol responses. Only its current holder MAY forward an xterm `onData` stream into the PTY. Other authorized clients SHALL remain live read-only observers and MAY request an explicit takeover; focus, attachment, or receipt of output alone SHALL NOT silently seize control. Handoff, disconnect, expiry, and revocation SHALL release the lease predictably and SHALL be visible to every attached client.

#### Scenario: Two clients attached to one session

- **WHEN** a Desktop client and a browser client are attached to one session
- **THEN** both render every output byte in order
- **AND** only the visible lease holder can produce interactive or emulator-generated input
- **AND** explicit takeover transfers that authority without duplicated terminal-query responses

#### Scenario: Observer focuses the terminal

- **WHEN** a read-only observer focuses, attaches, or receives output
- **THEN** it does not seize control without an explicit takeover

### Requirement: Lease expiry and renewal after suspension

Lease expiry SHALL distinguish an abandoned attachment from a temporarily suspended host. A still-live, write-authorized exact attachment MAY renew an unowned lease after its timers resume, including after operating-system sleep, and renewal SHALL NOT displace a different holder. If a presentation is read-only while no holder exists, its control surface SHALL remain visible and SHALL offer an explicit acquire action rather than silently discarding input behind an apparently interactive terminal.

#### Scenario: Host resumes from sleep

- **WHEN** a controlling attachment remains live across operating-system sleep and its timers resume
- **THEN** it renews the otherwise unowned lease
- **AND** renewal does not displace a different holder

#### Scenario: Automatic renewal cannot restore control

- **WHEN** automatic renewal cannot restore control and no holder exists
- **THEN** the terminal visibly offers acquisition
- **AND** it does not remain an unlabelled read-only surface silently discarding input

### Requirement: Initial presentation ownership

When a client creates a terminal, the server SHALL briefly reserve initial presentation ownership for that authenticated creator so reconciliation order cannot let an observing browser win a race by attaching first. The creator SHALL acquire the lease as part of its serialized attach; if it disconnects or fails to attach within the bounded reservation, the server SHALL elect an already attached write-authorized observer. For a pre-existing session with no reservation or holder, the first write-authorized attachment SHALL acquire the lease. Initial ownership SHALL NOT be a takeover and SHALL NOT displace an existing holder.

#### Scenario: Browser attaches before the creating desktop

- **WHEN** an observing browser attaches before the creating desktop client
- **THEN** the reservation keeps initial presentation ownership for the authenticated creator

#### Scenario: Creator never attaches

- **WHEN** the creator disconnects or fails to attach within the bounded reservation
- **THEN** the server elects an already attached write-authorized observer

#### Scenario: Pre-existing session

- **WHEN** a pre-existing session has no reservation and no holder
- **THEN** the first write-authorized attachment acquires the lease without displacing anyone

### Requirement: Control bar and takeover presentation

The owning surface SHALL show no controller badge or control affordance. A write-authorized observer SHALL show takeover UI only while a different live attachment is the holder, as a full-width terminal bar reading "Another device is controlling this terminal." with a "Take back control" action. A lease conflict SHALL be normal read-only presentation state, not a connection failure. The control bar SHALL be an opaque themed layout row above the terminal viewport that reserves its own height and never covers terminal output, the cursor, or the emulator input surface. Its geometry and appearance SHALL be identical in desktop and browser renderers and SHALL remain stable across active-tab changes.

#### Scenario: Sole attachment

- **WHEN** a sole local or remote attachment owns a terminal
- **THEN** it silently owns and fills that terminal with no controller or read-only badge

#### Scenario: Another device holds the lease

- **WHEN** a different live attachment holds the presentation lease
- **THEN** the write-authorized observer sees a full-width bar reading "Another device is controlling this terminal." with a "Take back control" action
- **AND** the state is presented as normal read-only presentation, not a connection failure

### Requirement: Takeover survives congestion recovery

Congestion recovery SHALL NOT drop the takeover action or apply it to a detached attachment: if the observer clicks during checkpoint resync, the replacement attach SHALL perform the requested acquire or takeover. Presentation events with an older revision SHALL NOT overwrite a newer local presentation state.

#### Scenario: Takeover clicked during resync

- **WHEN** an observer requests takeover while a checkpoint resync is in progress
- **THEN** the replacement attach performs the requested acquire or takeover

#### Scenario: Stale presentation event

- **WHEN** a presentation event arrives with an older revision than local state
- **THEN** it does not overwrite the newer local presentation state

### Requirement: Terminal journal routing

Terminal journal consumers SHALL route by the exact server, project, session, client, and attachment identity before strict event decoding. Auxiliary or other-client journal payloads SHALL NOT detach a valid terminal stream. An unknown event that does claim the exact attachment SHALL fail closed as a protocol violation.

#### Scenario: Payload for another client

- **WHEN** an auxiliary or other-client journal payload arrives
- **THEN** it does not detach the valid terminal stream

#### Scenario: Unknown event claiming the exact attachment

- **WHEN** an unrecognized event claims the exact server, project, session, client, and attachment identity
- **THEN** it fails closed as a protocol violation

### Requirement: Rejected input after a control change

If control changes while emulator or keyboard bytes are already queued, a server `presentation_owner` rejection SHALL definitively mean those bytes were not delivered. The old controller SHALL discard that stale queue and remain attached as a read-only observer, and SHALL NOT show a connection error or retry action.

#### Scenario: Control changes with queued bytes

- **WHEN** a server `presentation_owner` rejection is returned for queued emulator or keyboard bytes
- **THEN** those bytes were not delivered, the old controller discards the stale queue, and it remains attached as a read-only observer
- **AND** no connection error or retry action is shown

### Requirement: Presentation command result envelope

Presentation acquire, takeover, and renewal SHALL expose the presentation state as the standard command result payload. Because presentation state contains its own `revision`, the server handler SHALL retain the internal command-result wrapper so the dispatcher does not reinterpret that domain revision as transport metadata. The wire response SHALL contain exactly one command result envelope.

#### Scenario: Acquire returns presentation state

- **WHEN** an acquire, takeover, or renewal command returns presentation state carrying its own `revision`
- **THEN** the domain revision is not reinterpreted as transport metadata
- **AND** the wire response contains exactly one command result envelope

### Requirement: Ownership fits and publishes the viewport

Initial ownership and explicit takeover SHALL immediately fit the terminal to the owning surface and submit its current viewport. A resize attempted before the asynchronous attach completed SHALL be retained and submitted once ownership is known, so an unshared terminal always fills its panel and never retains a stale observer viewport.

#### Scenario: Resize before attach completes

- **WHEN** a resize is attempted before the asynchronous attach has completed
- **THEN** it is retained and submitted once ownership is known
- **AND** the terminal fills its panel rather than retaining a stale observer viewport

### Requirement: Coalesced resize submission

The controlling renderer SHALL fit its local emulator on every layout observation but SHALL coalesce a burst of changed viewport dimensions before submitting the authoritative PTY resize. The initial ownership and explicit-takeover viewport SHALL remain immediate. An interactive window or panel drag SHALL publish its final settled dimensions once.

#### Scenario: Interactive drag

- **WHEN** the user drags a window or panel edge through many intermediate sizes
- **THEN** the local display keeps fitting responsively and the authoritative PTY resize is published once with the final settled dimensions

### Requirement: Canonical PTY grid owned by the holder

The current presentation holder SHALL exclusively define the canonical PTY columns and rows. Every accepted holder resize SHALL be published to each exact terminal attachment. Read-only observers SHALL adopt that canonical grid locally, scaling it to their available panel when necessary, and their own layout observers SHALL NOT submit a resize or alter PTY dimensions. Attach and resume SHALL deliver the current canonical dimensions before replayed output. On takeover, the former holder's resize lease SHALL be released, the new holder SHALL clear any observer-size override, fit its own viewport, and immediately publish its dimensions; taking control back SHALL perform the same transition in reverse.

#### Scenario: Observer resizes its panel

- **WHEN** a read-only observer's panel changes size
- **THEN** it scales the canonical grid locally
- **AND** it submits no resize and does not alter PTY dimensions

#### Scenario: Attach delivers dimensions

- **WHEN** a client attaches or resumes
- **THEN** it receives the current canonical dimensions before replayed output

#### Scenario: Takeover

- **WHEN** an observer takes over the presentation
- **THEN** the former holder's resize lease is released, the new holder clears any observer-size override, fits its own viewport, and immediately publishes its dimensions

### Requirement: Non-interactive sources do not own presentation

Server-authorized non-interactive sources such as macros, dictation, and MCP SHALL retain their own scoped command authorization and SHALL enter the same ordered input queue, but SHALL NOT acquire presentation ownership. Automatic terminal replies SHALL NOT be identified by filtering particular escape strings; the complete emulator input stream SHALL be gated so two renderers cannot answer one PTY query and inject duplicate control responses.

#### Scenario: Macro sends input

- **WHEN** a macro, dictation, or MCP source sends input
- **THEN** it enters the same ordered input queue under its own scoped authorization
- **AND** it does not acquire presentation ownership

#### Scenario: PTY queries the emulator

- **WHEN** the PTY issues a query that the emulator answers automatically
- **THEN** gating the complete emulator input stream prevents a second renderer from injecting a duplicate control response

### Requirement: Terminal identity survives moves and window adoption

Terminal identity SHALL survive panel moves and native-window adoption.

#### Scenario: Panel moved or window adopted

- **WHEN** a terminal panel is moved or its native window is adopted
- **THEN** the terminal's identity is unchanged

### Requirement: Renderer reload restores interactive control

Reloading a renderer, including a cache-ignoring Force Reload, SHALL hydrate each still-running session from its checkpoint and SHALL make the restored surface the interactive presentation owner. Input and live output SHALL resume immediately, and a stale attachment from the discarded document SHALL NOT leave the tab looking live while silently discarding keystrokes.

#### Scenario: Force Reload

- **WHEN** a renderer is reloaded, including a cache-ignoring Force Reload
- **THEN** each still-running session hydrates from its checkpoint and the restored surface becomes the interactive presentation owner
- **AND** input and live output resume immediately without a stale attachment silently discarding keystrokes

### Requirement: Workspace facts sync to every device

A workspace's contents SHALL be shared across devices. Workspace facts SHALL sync to every device: a terminal existing, its title, its project, its shell, its output, and its removal. Closing a terminal SHALL remove it everywhere.

#### Scenario: Terminal closed on one device

- **WHEN** a user closes a terminal on one device
- **THEN** it is removed on every device, because the terminal is gone

#### Scenario: Terminal created on one device

- **WHEN** a terminal is created on one device
- **THEN** it appears on every device with its title, project, shell, and output

### Requirement: View state stays local to each device

View state SHALL NOT sync: which terminal tab is selected, which project tab is selected, split layout and pane sizes, scroll position, and focus. A terminal created on one device SHALL be selected only on the device that created it. A device reading one terminal SHALL NOT be moved to another because a second device made or selected something.

#### Scenario: Second device creates a terminal

- **WHEN** a second device creates or selects a terminal
- **THEN** the first device's selection, layout, pane sizes, scroll position, and focus are unchanged

### Requirement: Per-device selection memory

Each device SHALL remember its own selection per project and restore it on reconnect. That memory SHALL be treated as a hint: a remembered selection SHALL be validated against what exists and otherwise discarded. Storage that is unavailable, full, or disabled SHALL mean the device starts fresh rather than failing. A device with nothing selected SHALL take the first terminal it adopts. When the selected terminal is closed anywhere, each device SHALL independently select a neighbour.

#### Scenario: Workspace changed while away

- **WHEN** a device reconnects to a workspace whose projects and terminals have changed
- **THEN** its remembered selection is validated against what exists and otherwise discarded

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the device starts fresh rather than failing

#### Scenario: Nothing selected

- **WHEN** a device has nothing selected
- **THEN** it takes the first terminal it adopts rather than showing a blank workspace or following another device

#### Scenario: Selected terminal closed

- **WHEN** the selected terminal is closed anywhere
- **THEN** each device independently selects a neighbour

### Requirement: Congestion is not a connection failure

High-volume delivery, slow-renderer isolation, attachment-scoped resync, and recovery after genuine transport loss SHALL follow the terminal stream congestion and recovery contract. Terminal presentation congestion SHALL NOT invalidate the shared workspace connection.

#### Scenario: Terminal floods output

- **WHEN** a terminal's presentation becomes congested
- **THEN** the shared workspace connection remains valid
