# terminal-stream-congestion-and-recovery Specification

## Purpose

Terminay absorbs finite and sustained high-volume PTY output so that a slow terminal presentation converges to a current valid screen without turning into an application-wide failure, and so that genuine transport failures recover through an explicit, observable state machine.

## Requirements

### Requirement: Uniform congestion semantics across hosts

The congestion and recovery contract SHALL apply equally to embedded Local, browser, and remote clients. Transport latency SHALL change when congestion occurs but SHALL NOT change terminal or recovery semantics.

#### Scenario: Remote client under congestion

- **WHEN** a remote client congests a terminal presentation lane
- **THEN** it follows the same terminal and recovery semantics as an embedded Local client

### Requirement: Presentation-stream traffic ownership

Raw terminal output SHALL be presentation-stream traffic rather than reliable global workspace-event traffic, delivered through a bounded lane owned by the exact `{serverId, projectId, sessionId, clientId, attachmentId}` identity. Each attachment SHALL have independent byte and frame limits, acknowledgement state, and congestion state, and one attachment SHALL NOT consume another attachment's budget.

#### Scenario: Two attachments on one connection

- **WHEN** one attachment exhausts its presentation budget
- **THEN** another attachment's byte and frame limits, acknowledgement state, and congestion state are unaffected

### Requirement: Reserved control capacity

Connection control traffic — handshake, command and query results, cancellation, subscription lifecycle, resynchronization, and connection recovery — SHALL have reserved bounded delivery capacity and SHALL NOT be starved or displaced by terminal presentation bytes. Subscription events, including workspace and feature projections, SHALL be reconstructible state traffic rather than reliable RPC control. The transport SHALL have one ordered writer whose scheduler fairly selects independently bounded traffic classes rather than admitting all frames into one undifferentiated FIFO.

#### Scenario: Noisy terminal during a workspace command

- **WHEN** a terminal floods its presentation lane while a workspace command is issued
- **THEN** the command result is delivered from reserved control capacity

#### Scenario: Scheduler fairness

- **WHEN** multiple traffic classes have pending frames
- **THEN** the single ordered writer fairly selects among independently bounded classes

### Requirement: Independent PTY observers

The terminal service, recording service, activity projection, and checkpoint authority MAY observe the same PTY bytes but SHALL NOT share a renderer presentation queue. Recording policy SHALL determine whether the complete raw stream is retained; terminal presentation SHALL remain bounded by configured screen and scrollback limits.

#### Scenario: Recording during congestion

- **WHEN** a presentation lane congests while recording is active
- **THEN** recording retention follows recording policy and is not bound to the renderer presentation queue

### Requirement: Server continues consuming PTY output

The server SHALL continue consuming PTY output into its bounded replay and canonical checkpoint state when a renderer cannot keep up. It SHALL NOT indefinitely buffer the lifetime transcript, pause unrelated terminal sessions, or block the PTY merely to preserve obsolete intermediate repaints for one display.

#### Scenario: Renderer falls behind

- **WHEN** one renderer cannot keep up with PTY output
- **THEN** the server keeps consuming output into bounded replay and checkpoint state without blocking the PTY or pausing other sessions

### Requirement: Lane overflow handling

When an attachment's presentation lane reaches its limit, the server SHALL stop admitting further raw output to that lane, discard only that attachment's pending presentation frames, state the discarded byte range as one ordered `skip` marker carried in that lane's own stream bounded by what the transport actually accepted, suppress further output for that attachment until it is replaced, keep the PTY, connection, workspace subscriptions, and other attachments alive, and rehydrate that display from an authoritative parser-safe checkpoint before resuming live output.

#### Scenario: Lane reaches its limit

- **WHEN** an attachment's presentation lane reaches its limit
- **THEN** further raw output to that lane stops, only that attachment's pending frames are discarded, and one ordered `skip` marker states the discarded byte range

#### Scenario: Other work during overflow

- **WHEN** one attachment overflows
- **THEN** the PTY, the connection, workspace subscriptions, and other attachments stay alive

#### Scenario: Resuming after overflow

- **WHEN** the overflowing display is replaced
- **THEN** it rehydrates from an authoritative parser-safe checkpoint before live output resumes

### Requirement: In-band discontinuity

A discontinuity SHALL always be in band. A client's stream position SHALL advance only by delivered output or by a skip naming the range it replaces, so a client never reconciles an advisory computed against a position it has already passed. Exactly one component — the delivery lane that knows what reached the wire — MAY drop presentation bytes. Reconnects SHALL state the position the display actually rendered or request a fresh presentation; no component SHALL substitute a remembered cursor of its own.

#### Scenario: Client stream position advances

- **WHEN** a client's stream position changes
- **THEN** it advanced either by delivered output or by a skip naming the range it replaces

#### Scenario: Reconnecting a display

- **WHEN** a display reconnects
- **THEN** it states the position it actually rendered or requests a fresh presentation, and no component substitutes a remembered cursor

### Requirement: Bounded checkpoint catch-up

Feeding the checkpoint authority SHALL be bounded work that trails the live head under sustained output. A fresh presentation SHALL wait for it to catch up before pinning a checkpoint, within a deadline that a terminal which never falls silent cannot exceed. If it still trails by more than a presentation lane can carry, the stream SHALL begin at the live head and the intervening range SHALL be stated as a skip.

#### Scenario: Checkpoint catches up

- **WHEN** a fresh presentation is requested while output continues
- **THEN** it waits within a bounded deadline for the checkpoint authority and pins a current checkpoint

#### Scenario: Checkpoint trails too far

- **WHEN** the checkpoint authority still trails by more than a presentation lane can carry
- **THEN** the stream begins at the live head and the intervening range is stated as a skip

### Requirement: Attach-time gaps do not re-arm hydration

A gap established while a display is attaching SHALL NOT be treated as a signal to attach again, because it is already covered by the position that attachment starts from. Only a live display that fell behind SHALL re-hydrate.

#### Scenario: Gap during attach

- **WHEN** a gap is established while a display is attaching
- **THEN** hydration does not re-arm and the display paints

#### Scenario: Live display falls behind

- **WHEN** a live streaming display falls behind
- **THEN** it re-hydrates

### Requirement: A display can always recover

Whether a re-attach is already pending for a gap SHALL be state a recovery controller owns, and every path out of recovery SHALL either start that re-attach or return the display to streaming where the next skip is honoured. Declining an attempt because a newer attachment has taken the display over SHALL end that attempt and never the display's ability to recover; the same SHALL apply to an attach that fails or throws. No sequence of skips, attach completions, and retry timers SHALL leave a display that ignores skips with no re-attach pending.

#### Scenario: Newer attachment takes over

- **WHEN** a recovery attempt is declined because a newer attachment took the display over
- **THEN** only that attempt ends and the display can still recover

#### Scenario: Attach fails or throws

- **WHEN** an attach attempt fails or throws
- **THEN** the display retains a pending re-attach or returns to streaming where the next skip is honoured

#### Scenario: Interleaved skips and retries

- **WHEN** skips, attach completions, and retry timers interleave arbitrarily
- **THEN** no display is left ignoring skips with no re-attach pending

### Requirement: Silent latch prohibition

A display SHALL NOT be latched out of recovery. Such a failure is silent because the display keeps its connection, keeps accepting keystrokes, keeps its painted screen, and reports no error while never painting again.

#### Scenario: Display stops painting

- **WHEN** a display stops receiving new output while its connection stays open and healthy
- **THEN** the condition is observable and recovery proceeds rather than the display latching silently

### Requirement: Contiguous checkpoint-to-live transition

The checkpoint-to-live transition SHALL be contiguous and ordered. Output and resize events arriving during rehydration SHALL be bounded, and any second overflow SHALL repeat the same attachment-scoped recovery rather than widening memory limits or closing the application connection.

#### Scenario: Resize during rehydration

- **WHEN** output and resize events arrive during rehydration
- **THEN** they are bounded and the transition to live output remains contiguous and ordered

#### Scenario: Second overflow

- **WHEN** a lane overflows again during or after recovery
- **THEN** the same attachment-scoped recovery repeats without widening memory limits or closing the application connection

### Requirement: Input and lease handling during recovery

Terminal input SHALL be disabled only while the controlling display lacks a valid current presentation and SHALL be restored after hydration without creating another PTY or silently changing presentation ownership. Congestion resync SHALL NOT detach the recovering attachment before its replacement attach. Same-client attachment replacement SHALL transfer an existing lease to the new attachment without leaving it unowned, so another client's renewal cannot steal control during recovery. A Take back control request made while recovery is in flight SHALL be applied to the replacement attachment rather than targeting a detached one or being discarded.

#### Scenario: Input restored after hydration

- **WHEN** a display completes hydration
- **THEN** terminal input is restored without creating another PTY or changing presentation ownership

#### Scenario: Lease during replacement

- **WHEN** a same-client attachment is replaced during recovery
- **THEN** the existing lease transfers to the new attachment and is never unowned

#### Scenario: Take back control during recovery

- **WHEN** a Take back control request is made while recovery is in flight
- **THEN** it is applied to the replacement attachment

### Requirement: Recovery never waits for PTY silence

Recovery SHALL NOT wait indefinitely for complete PTY silence. A continuously updating prompt, progress display, or agent SHALL remain recoverable: the client SHALL request current bounded checkpoints on a bounded retry schedule, replace an obsolete recovery attempt when it falls behind again, and expose the most recent completed presentation while it catches up. Each attempt SHALL have a bounded deadline. A failed attempt SHALL either advance to another checkpoint or become a visible retryable error; the terminal SHALL NOT remain on an unqualified loading surface with no deadline or diagnostic transition.

#### Scenario: Continuously producing terminal recovers

- **WHEN** a terminal never becomes idle during recovery
- **THEN** bounded checkpoint attempts continue until one commits and the most recent completed presentation is exposed meanwhile

#### Scenario: Attempt exceeds its deadline

- **WHEN** a recovery attempt exceeds its bounded deadline
- **THEN** it advances to another checkpoint or becomes a visible retryable error

### Requirement: Invalid congestion strategies

Congestion SHALL NOT be reported as a transport failure. Increasing a global queue, silently dropping raw frames, replaying from an arbitrary byte suffix, and closing the shared application connection SHALL NOT be valid recovery strategies.

#### Scenario: Lane congests

- **WHEN** a presentation lane congests
- **THEN** the shared application connection stays open, no global queue grows, no raw frames are silently dropped, and no arbitrary byte suffix is replayed

### Requirement: Activity revisions are current state

Terminal activity SHALL be current state rather than one durable event per PTY callback. Raw output SHALL refresh the server-owned inactivity deadline, but repeated output leaving status, attention, acknowledgement, authority, and source unchanged SHALL NOT advance the public activity revision or `updatedAt`. Semantic transitions SHALL remain ordered and replayable.

#### Scenario: Thousands of PTY callbacks

- **WHEN** thousands of PTY callbacks produce no change to status, attention, acknowledgement, authority, or source
- **THEN** the public activity revision and `updatedAt` do not advance

#### Scenario: Semantic transition occurs

- **WHEN** a semantic activity transition occurs
- **THEN** it is published as an ordered, replayable change

### Requirement: Session-owned host observation under load

PTY-derived host observation SHALL be session-owned bounded work. A terminal's continued output MAY supersede that terminal's pending foreground-process sample but SHALL NOT create an unbounded observation backlog or require output silence before a current sample completes. Slow process observation SHALL be contained to its exact session and become an explicit limited state; it SHALL NOT starve application control, workspace operations, or a close request for a different terminal.

#### Scenario: Slow observation on a noisy terminal

- **WHEN** foreground observation is slow for a continuously outputting terminal
- **THEN** it becomes an explicit limited state for that session and does not delay a close request for another terminal

### Requirement: Bounded projection delivery for subscriptions

Every non-terminal subscription event SHALL use a separately bounded projection delivery class. Full snapshots SHALL use stable semantic keys so a pending value for the same subscription and entity supersedes its obsolete predecessor. Ordered deltas SHALL retain their revision identity until the bound is reached. If a subscription exceeds its bound, its backlog SHALL become one scoped resynchronization request and the client SHALL reload the authoritative feature snapshot. RPC results and application control SHALL retain reserved capacity. No volume or timing of reconstructible state, including agent snapshots derived from terminal journal ingestion, SHALL close the application connection.

#### Scenario: Superseded snapshot

- **WHEN** a newer full snapshot is pending for the same subscription and entity
- **THEN** it supersedes its obsolete predecessor under the stable semantic key

#### Scenario: Subscription exceeds its bound

- **WHEN** a subscription's backlog exceeds its bound
- **THEN** the backlog becomes one scoped resynchronization request and the client reloads the authoritative feature snapshot

#### Scenario: Journal replay flood

- **WHEN** a replayed journal produces thousands of agent-status snapshots
- **THEN** they coalesce or resynchronize within their subscription lane and the application connection stays open

### Requirement: Connection failure state machine

A real transport failure SHALL use the explicit client state machine `connected → reconnecting → authenticating → resubscribing → hydrating → connected`.

#### Scenario: Transport fails

- **WHEN** a genuine transport failure occurs
- **THEN** the client traverses reconnecting, authenticating, resubscribing, and hydrating before returning to connected

### Requirement: Protocol liveness is transport-generation liveness

Application-protocol liveness SHALL be part of transport generation liveness. If the server protocol reader ends or fails, the mounted client SHALL be treated as unusable even when its WebRTC peer and required data channels remain open. ICE `failed` or `closed`, or inbound application frames that cannot be decoded as bytes, SHALL be the same class of failure. ICE `disconnected` while `connectionState` remains `connected` SHALL NOT be that class, because Safari and Firefox report it during consent checks while channels still deliver. A true transport failure SHALL retire the whole client and peer generation; it SHALL NOT be treated as a terminal-panel error and SHALL NOT be repaired by renewing an attachment on the retired client.

#### Scenario: Protocol reader ends with an open peer

- **WHEN** the server protocol reader ends while the WebRTC peer and required data channels remain open
- **THEN** the whole client and peer generation is retired and replaced

#### Scenario: Undecodable application frame

- **WHEN** an inbound application frame cannot be decoded as bytes
- **THEN** the generation fails rather than the frame being ignored

#### Scenario: ICE disconnected during a consent check

- **WHEN** ICE reports `disconnected` while `connectionState` remains `connected`
- **THEN** the generation is not replaced

### Requirement: Liveness detection by heartbeat

A checkpoint or attach snapshot without later live PTY or workspace events SHALL NOT count as a successful connection. Congestion recovery SHALL still apply when frames arrive and overwhelm a presentation lane. A transport that has gone silent while reporting open SHALL be detected by a connection heartbeat — a periodic application-protocol ping with a bounded response deadline — and SHALL NOT be inferred from PTY quietness or traffic patterns. A missed heartbeat SHALL be a transport-generation failure; an idle but responsive connection SHALL be healthy.

#### Scenario: Silent transport reporting open

- **WHEN** a transport stops delivering while reporting open
- **THEN** the missed heartbeat response deadline retires the transport generation

#### Scenario: Idle responsive connection

- **WHEN** a connection is idle but answers heartbeats
- **THEN** it is healthy and is not replaced

### Requirement: Connection-scoped attachment lifetime

Attachment lifetime SHALL be scoped to the exact connection that created the attachment. Closing one connection SHALL release only that connection's attachments, leases, and checkpoints. Another connection authenticated by the same device, including the replacement created by a reconnect, SHALL be unaffected by the old connection's teardown whenever it happens.

#### Scenario: Superseded connection fails later

- **WHEN** a reconnect from the same device replaces a prior connection and the superseded connection later fails
- **THEN** only its own attachments, leases, and checkpoints are released and the replacement connection's live stream is unaffected

### Requirement: Explicit attachment closure and suppression exit

When the server detaches an attachment for any reason other than the client's own detach request, it SHALL deliver an explicit attachment-closed skip; a stream SHALL NOT end silently while its connection remains open. Congestion suppression SHALL end when the replacement attachment attaches and only then. Suppression SHALL NOT be ended by an acknowledgement, because no output is published while suppression holds.

#### Scenario: Server-initiated detach

- **WHEN** the server detaches an attachment for a reason other than the client's detach request
- **THEN** it delivers an explicit attachment-closed skip

#### Scenario: Acknowledgement during suppression

- **WHEN** an acknowledgement arrives while congestion suppression holds
- **THEN** suppression is not lifted and only the replacement attachment attaching ends it

### Requirement: Positioning faults are never discarded

No terminal-stream component SHALL discard a positioning fault silently. A gap that reaches a client SHALL be reported and recovered from rather than swallowed into a value nothing reads again, so a stream that has stopped is observable rather than indistinguishable from an idle terminal.

#### Scenario: Injected ordering fault

- **WHEN** a server-side ordering fault is injected
- **THEN** the client surfaces an explicit recoverable failure rather than silently stopping updates

### Requirement: Renderer behaviour while the client is unusable

The renderer SHALL visibly mark mounted terminal panels and connection chrome as reconnecting and SHALL reject unsafe mutations promptly while the old client is unusable. Desktop SHALL supply a fresh server-scoped MessagePort; the browser session host SHALL replace its complete WebRTC transport generation and supply a fresh opaque endpoint. The client SHALL NOT reuse a half-closed connection and SHALL NOT obtain raw transport channels.

#### Scenario: Client becomes unusable

- **WHEN** the mounted client becomes unusable
- **THEN** terminal panels and connection chrome are visibly marked reconnecting and unsafe mutations are rejected promptly

#### Scenario: Fresh endpoint supplied

- **WHEN** a transport generation is replaced
- **THEN** Desktop supplies a fresh server-scoped MessagePort and the browser session host supplies a fresh opaque endpoint, and no half-closed connection or raw transport channel is reused

### Requirement: Post-reconnect restoration

After reconnecting, the client SHALL reload the authoritative workspace snapshot, resubscribe feature projections from confirmed revisions, and reattach each mounted terminal from its confirmed position or a fresh checkpoint. Recovery SHALL use bounded retry with backoff and SHALL remain active until it succeeds, the user selects another connection, or the window closes. A failed recovery SHALL be visible and actionable and the application SHALL NOT remain silently mounted with disposed terminal clients.

#### Scenario: Reconnection completes

- **WHEN** a client reconnects
- **THEN** it reloads the authoritative workspace snapshot, resubscribes projections from confirmed revisions, and reattaches each mounted terminal from its confirmed position or a fresh checkpoint

#### Scenario: Recovery keeps failing

- **WHEN** recovery repeatedly fails
- **THEN** it retries with bounded backoff and remains visible and actionable until it succeeds, another connection is selected, or the window closes

### Requirement: Single recovery controller and input safety

Automatic recovery and a terminal-panel retry SHALL invoke the same stable, connection-scoped recovery controller. Retry SHALL NOT call a callback captured from a retired renderer generation and SHALL NOT call attach or resume on the failed client. Once a terminal write has an uncertain outcome, later queued input SHALL be discarded and the panel SHALL accept no more input until a replacement client has hydrated and reattached the terminal. Recovery UI SHALL clear only after a post-recovery command can traverse the replacement endpoint.

#### Scenario: Manual retry

- **WHEN** a user presses a terminal-panel retry
- **THEN** it invokes the same connection-scoped recovery controller as automatic recovery and never calls attach or resume on the failed client

#### Scenario: Uncertain terminal write

- **WHEN** a terminal write has an uncertain outcome
- **THEN** later queued input is discarded and the panel accepts no input until a replacement client has hydrated and reattached the terminal

#### Scenario: Recovery UI clears

- **WHEN** recovery completes
- **THEN** the recovery UI clears only after a post-recovery command traverses the replacement endpoint

### Requirement: Resource and security boundaries

Presentation-lane bytes, frames, age, and skip frequency SHALL have named hard limits and metadata-only diagnostics. Control capacity SHALL be bounded and reserved so hostile terminal output cannot allocate it. Scheduling SHALL be fair across terminal attachments and SHALL NOT be influenced by terminal content, title, project name, or escape sequences. Checkpoints and recovery notifications SHALL retain the existing exact attachment, client, project, session, authorization, expiry, and one-use boundaries. A genuinely failed or malicious transport MAY still close its own connection at the final connection safety ceiling, and feature-lane congestion SHALL be contained before reaching that ceiling.

#### Scenario: Hostile terminal output

- **WHEN** terminal output attempts to influence scheduling or allocate control capacity
- **THEN** scheduling stays fair across attachments and reserved control capacity is unaffected

#### Scenario: Checkpoint authorization

- **WHEN** a checkpoint or recovery notification is issued
- **THEN** it retains its exact attachment, client, project, session, authorization, expiry, and one-use boundaries

### Requirement: Content-free diagnostics

Diagnostics SHALL record lane identity using opaque ids plus byte and frame counts, positions, state transitions, and close or reconnect outcomes. They SHALL never record terminal bytes, commands, paths, credentials, or secrets.

#### Scenario: Congestion diagnostic emitted

- **WHEN** a queue or recovery diagnostic is emitted
- **THEN** it identifies the affected opaque lane and the precise resource transition and contains no terminal content

### Requirement: Burst and sustained-output outcomes

A large local PTY burst SHALL eventually present its completion marker, accept subsequent input, and permit a new terminal to be created without a connection restart. Sustained output SHALL keep process and renderer memory within configured bounds. A stalled terminal display SHALL resynchronize without interrupting another interactive terminal or workspace command on the same connection. Multiple noisy terminals SHALL receive fair progress and none SHALL starve control traffic or another attachment indefinitely.

#### Scenario: 200 MiB burst

- **WHEN** a 200 MiB local PTY burst is produced
- **THEN** the completion marker eventually presents, input is accepted, and a new terminal can be created without a connection restart

#### Scenario: Stalled display beside an interactive terminal

- **WHEN** one terminal display stalls and resynchronizes
- **THEN** another interactive terminal and workspace commands on the same connection are uninterrupted

#### Scenario: Several noisy terminals

- **WHEN** several terminals produce sustained output
- **THEN** each receives fair progress and none starves control traffic or another attachment

### Requirement: Close is not delayed by unrelated terminals

A continuously outputting or slow-to-observe terminal SHALL NOT delay closing an unrelated idle terminal. The target close SHALL either observe its own foreground state within a bounded deadline or continue with that session's latest committed busy or idle evidence; missing observation SHALL NOT prompt and SHALL NOT wait on another terminal.

#### Scenario: Closing an idle terminal beside a noisy one

- **WHEN** a user closes an idle terminal while another terminal outputs continuously
- **THEN** the close observes its own foreground state within a bounded deadline or proceeds on that session's latest committed evidence without prompting or waiting

### Requirement: Parser-boundary recovery equivalence

Congestion across UTF-8, CSI, OSC, DCS, alternate-screen, resize, and synchronized-output boundaries SHALL restore a presentation equivalent to the canonical checkpoint and later live stream.

#### Scenario: Congestion mid-sequence

- **WHEN** congestion occurs across a UTF-8, CSI, OSC, DCS, alternate-screen, resize, or synchronized-output boundary
- **THEN** the restored presentation is equivalent to the canonical checkpoint plus the later live stream

### Requirement: Transport failure recovery outcomes

Forced Local MessagePort, WebSocket, and WebRTC failures SHALL automatically reconnect, reload workspace state, and hydrate existing terminal panels without duplicating PTYs, output, input, or workspace mutations. A required WebRTC lane closing while the peer remains connected SHALL be a full transport-generation failure, and automatic recovery and manual Retry SHALL each replace all lanes and restore exact ordered input without reloading the page. A server application-protocol reader ending while the native peer and application lane remain open SHALL follow the same full-generation replacement path.

#### Scenario: Forced transport failure

- **WHEN** a Local MessagePort, WebSocket, or WebRTC transport is forcibly failed
- **THEN** the client reconnects, reloads workspace state, and hydrates terminal panels without duplicating PTYs, output, input, or workspace mutations

#### Scenario: Required lane closes with a connected peer

- **WHEN** a required WebRTC lane closes while the peer remains connected
- **THEN** automatic recovery and manual Retry each replace all lanes and restore exact ordered input without a page reload

#### Scenario: Reader ends with peer and lane open

- **WHEN** the server application-protocol reader ends while the native peer and application lane remain open
- **THEN** the client recovers through full-generation replacement rather than remaining mounted in a permanent not-connected state, and post-recovery input is delivered exactly once

### Requirement: ICE state handling outcomes

ICE `disconnected` while the peer stays `connected` SHALL NOT replace the generation. Peer `disconnected`, or ICE `disconnected` while the peer is also not `connected`, SHALL either resume delivery inside grace or replace once. The mounted workspace SHALL NOT stay on a painted checkpoint with no later PTY bytes: reader end, required-lane close, and heartbeat miss SHALL each replace the generation within their bound.

#### Scenario: Peer disconnected

- **WHEN** the peer reports `disconnected`, or ICE reports `disconnected` while the peer is also not `connected`
- **THEN** delivery resumes inside the grace period or the generation is replaced exactly once

#### Scenario: Painted checkpoint with no later bytes

- **WHEN** a mounted workspace holds a painted checkpoint and no later PTY bytes arrive
- **THEN** reader end, required-lane close, or heartbeat miss replaces the generation within its bound

### Requirement: Repeated congestion and skip outcomes

A lane that congests, skips, and congests again SHALL recover each time on the same connection; no suppression SHALL persist after the replacement attachment attaches, and an acknowledgement alone SHALL never lift it. A renderer that stops acknowledging under sustained output SHALL produce exactly one bounded congestion and one skip, then stream again as soon as its replacement attachment attaches, even while the producer never goes idle.

#### Scenario: Renderer stops acknowledging

- **WHEN** a renderer stops acknowledging under sustained output
- **THEN** exactly one bounded congestion and one skip occur, and streaming resumes as soon as the replacement attachment attaches

#### Scenario: Repeated congestion on one connection

- **WHEN** a lane congests, skips, and congests again
- **THEN** it recovers each time on the same connection with no persisting suppression

### Requirement: Fresh presentation and multi-device outcomes

A fresh presentation taken while a terminal is producing continuously SHALL pin a current checkpoint, hydrate without a gap, and attach exactly once. A terminal observed by several devices SHALL stream to all of them; holding the presentation lease SHALL govern who may write and never who receives output.

#### Scenario: Fresh presentation on a busy terminal

- **WHEN** a fresh presentation is taken while a terminal produces continuously
- **THEN** it pins a current checkpoint, hydrates without a gap, and attaches exactly once

#### Scenario: Terminal observed by several devices

- **WHEN** several devices observe one terminal
- **THEN** all of them receive output and only the presentation lease holder may write

### Requirement: Frame decoding conformance

Application-lane `Blob` frames SHALL be decoded in order or fail that generation. Chromium loopback happy-path evidence SHALL NOT be sufficient conformance evidence; coverage SHALL inject ICE disconnect and non-`ArrayBuffer` binary delivery.

#### Scenario: Non-ArrayBuffer binary delivery

- **WHEN** an application-lane frame is delivered as a `Blob`
- **THEN** it is decoded in order or that generation fails

### Requirement: Loading-surface convergence

Sustained output that never becomes completely idle SHALL NOT pin a terminal on **Loading terminal**. Bounded checkpoint attempts SHALL continue until one commits, and every start, retry, completion, timeout, and terminal failure SHALL be observable.

#### Scenario: Never-idle terminal loading

- **WHEN** a terminal produces sustained output and never becomes idle
- **THEN** bounded checkpoint attempts continue until one commits and each start, retry, completion, timeout, and terminal failure is observable

### Requirement: Congestion and recovery non-goals

A terminal display SHALL NOT be required to paint every obsolete intermediate frame after it falls behind; it SHALL be required to converge to the correct bounded screen and scrollback state. Terminal presentation SHALL NOT become an unbounded transcript store. Local transport SHALL NOT receive an unlimited-memory exemption. This capability SHALL NOT change recording retention, presentation ownership, or terminal-session authorization policy.

#### Scenario: Display falls behind

- **WHEN** a display falls behind the live stream
- **THEN** it converges to the correct bounded screen and scrollback state without painting every obsolete intermediate frame

#### Scenario: Local transport memory

- **WHEN** a Local transport carries sustained output
- **THEN** it is bounded like any other transport with no unlimited-memory exemption
