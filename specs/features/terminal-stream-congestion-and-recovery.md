# Terminal stream congestion and recovery

## Summary

Terminay accepts finite and sustained high-volume PTY output without turning a
slow terminal presentation into an application-wide failure. A terminal that
outpaces one renderer converges to a current, valid presentation while
workspace commands, unrelated terminals, and the connection control plane stay
available.

This contract applies equally to embedded Local, browser, and remote clients.
Transport latency changes when congestion occurs; it does not change terminal
or recovery semantics.

## Traffic ownership

Raw terminal output is presentation-stream traffic, not reliable global
workspace-event traffic. It is delivered through a bounded lane owned by the
exact `{serverId, projectId, sessionId, clientId, attachmentId}` identity.
Each attachment has independent byte and frame limits, acknowledgement state,
and congestion state. One attachment cannot consume another attachment's
budget.

Connection control traffic includes handshake, command and query results,
cancellation, subscription lifecycle, resynchronization, and connection
recovery. It has reserved bounded delivery capacity and cannot be starved or
displaced by terminal presentation bytes. Subscription events, including
workspace and feature projections, are reconstructible state traffic rather
than reliable RPC control. The transport has one ordered writer, but its
scheduler fairly selects independently bounded traffic classes instead of
admitting all frames into one undifferentiated FIFO.

The terminal service, recording service, activity projection, and checkpoint
authority may observe the same PTY bytes, but they do not share a renderer
presentation queue. Recording policy determines whether the complete raw
stream is retained; terminal presentation remains bounded by configured screen
and scrollback limits.

## Congestion behaviour

The server continues consuming PTY output into its bounded replay and canonical
checkpoint state when a renderer cannot keep up. It does not indefinitely
buffer the lifetime transcript, pause unrelated terminal sessions, or block
the PTY merely to preserve obsolete intermediate repaints for one display.

When an attachment's presentation lane reaches its limit, the server:

1. stops admitting further raw output to that lane;
2. discards only that attachment's pending presentation frames;
3. records the exact last presentation position confirmed by the client;
4. schedules a bounded `resync_required` notification on the control lane;
5. keeps the PTY, connection, workspace subscriptions, and other attachments
   alive; and
6. rehydrates that display from an authoritative parser-safe checkpoint before
   resuming live output.

The checkpoint-to-live transition is contiguous and ordered. Output and resize
events arriving during rehydration are bounded, and any second overflow repeats
the same attachment-scoped recovery rather than widening memory limits or
closing the application connection. Terminal input is disabled only while the
controlling display lacks a valid current presentation; it is restored after
hydration without creating another PTY or silently changing presentation
ownership.

Recovery never waits indefinitely for complete PTY silence. A continuously
updating prompt, progress display, or agent remains recoverable: the client
requests current bounded checkpoints on a bounded retry schedule, replaces an
obsolete recovery attempt when it falls behind again, and exposes the most
recent completed presentation while it catches up. Each attempt has a bounded
deadline. A failed attempt either advances to another checkpoint or becomes a
visible retryable error; the terminal cannot remain on an unqualified loading
surface with no deadline or diagnostic transition.

Congestion is not reported as a transport failure. Increasing a global queue,
silently dropping raw frames, replaying from an arbitrary byte suffix, and
closing the shared application connection are not valid recovery strategies.

## PTY-derived state projections

Terminal activity is current state, not one durable event per PTY callback.
Raw output refreshes the server-owned inactivity deadline, but repeated output
that leaves status, attention, acknowledgement, authority, and source
unchanged does not advance the public activity revision or `updatedAt`.
Semantic transitions remain ordered and replayable.

PTY-derived host observation is also session-owned bounded work. A terminal's
continued output can supersede that terminal's pending foreground-process
sample, but it cannot create an unbounded observation backlog or require
output silence before a current sample completes. Slow process observation is
contained to its exact session and becomes an explicit limited state; it never
starves application control, workspace operations, or a close request for a
different terminal.

Every non-terminal subscription event uses a separately bounded projection
delivery class. Full snapshots use stable semantic keys so a pending value for
the same subscription and entity supersedes its obsolete predecessor. Ordered
deltas retain their revision identity until the bound is reached. If a
subscription exceeds its bound, its backlog becomes one scoped
resynchronization request and the client reloads the authoritative feature
snapshot. RPC results and application control retain reserved capacity. No
volume or timing of reconstructible state, including agent snapshots derived
from terminal journal ingestion, may close the application connection.

## Genuine connection failure

A real transport failure uses an explicit client state machine:

`connected → reconnecting → authenticating → resubscribing → hydrating → connected`.

For this state machine, application-protocol liveness is part of transport
generation liveness. If the server protocol reader ends or fails, the mounted
client is no longer usable even when its WebRTC peer and required data channels
remain open. ICE `disconnected` while `connectionState` remains `connected`,
or inbound application frames that cannot be decoded as bytes, are the same
class of failure: the generation cannot deliver live events. That signal
retires the whole client/peer generation; it is not a terminal-panel error and
cannot be repaired by renewing an attachment on the retired client.

A checkpoint or attach snapshot without later live PTY events is not a
successful connection. Congestion recovery still applies when frames arrive
and overwhelm a presentation lane. It does not apply when the transport has
gone silent while reporting open.

The renderer visibly marks mounted terminal panels as reconnecting and rejects
unsafe mutations promptly while the old client is unusable. Desktop supplies a
fresh server-scoped MessagePort; the browser session host replaces its complete
WebRTC transport generation and supplies a fresh opaque endpoint. The client
never reuses a half-closed connection or obtains raw transport channels.

After reconnecting, the client reloads the authoritative workspace snapshot,
resubscribes feature projections from confirmed revisions, and reattaches each
mounted terminal from its confirmed position or a fresh checkpoint. Recovery
uses bounded retry with backoff and remains active until it succeeds, the user
selects another connection, or the window closes. A failed recovery is visible
and actionable; the application never remains silently mounted with disposed
terminal clients. Automatic recovery and a terminal-panel retry invoke the
same stable, connection-scoped recovery controller. Retry never calls a
callback captured from a retired renderer generation, and it never calls
attach or resume on the failed client. Once a terminal write has an uncertain
outcome, later queued input is discarded and the panel accepts no more input
until a replacement client has hydrated and reattached the terminal. Recovery
UI clears only after a post-recovery command can traverse the replacement
endpoint.

## Resource and security boundaries

- Presentation-lane bytes, frames, age, and resynchronization frequency have
  named hard limits and metadata-only diagnostics.
- Control capacity is bounded and reserved; hostile terminal output cannot
  allocate it.
- Scheduling is fair across terminal attachments and cannot be influenced by
  terminal content, title, project name, or escape sequences.
- Checkpoints and recovery notifications retain the existing exact attachment,
  client, project, session, authorization, expiry, and one-use boundaries.
- Diagnostics record lane identity using opaque ids plus byte/frame counts,
  positions, state transitions, and close/reconnect outcomes. They never record
  terminal bytes, commands, paths, credentials, or secrets.
- A genuinely failed or malicious transport can still close its own
  connection at the final connection safety ceiling. Feature-lane congestion
  is contained before reaching that ceiling.

## Acceptance outcomes

- A 200 MiB local PTY burst eventually presents its completion marker, accepts
  subsequent input, and permits a new terminal to be created without a
  connection restart.
- Sustained output keeps process and renderer memory within configured bounds.
- A stalled terminal display resynchronizes without interrupting another
  interactive terminal or workspace command on the same connection.
- Multiple noisy terminals receive fair progress; none can starve control
  traffic or another attachment indefinitely.
- A continuously outputting or slow-to-observe terminal cannot delay closing an
  unrelated idle terminal. The target close either observes its own foreground
  state within a bounded deadline or continues with that session's latest
  committed busy/idle evidence; missing observation does not prompt and does
  not wait on another terminal.
- Congestion across UTF-8, CSI, OSC, DCS, alternate-screen, resize, and
  synchronized-output boundaries restores a presentation equivalent to the
  canonical checkpoint and later live stream.
- Forced Local MessagePort, WebSocket, and WebRTC failures automatically
  reconnect, reload workspace state, and hydrate existing terminal panels
  without duplicating PTYs, output, input, or workspace mutations.
- A required WebRTC lane closing while the peer remains connected is a full
  transport-generation failure. Automatic recovery and manual Retry each
  replace all lanes and restore exact ordered input without reloading the page.
- A server application-protocol reader ending while the native peer and
  application lane remain open follows the same full-generation replacement
  path. A real Chromium/native-WebRTC test proves the peer and lane are still
  open at injection, observes recovery rather than a permanently mounted
  `client is not connected` state, and proves post-recovery input exactly once.
- ICE `disconnected` with channels still `open` either resumes delivery inside
  the grace period or replaces the generation once. The mounted workspace does
  not stay on a painted checkpoint with no later PTY bytes.
- Application-lane `Blob` frames are decoded in order or fail that generation.
  Chromium loopback happy-path evidence is not sufficient; tests inject ICE
  disconnect and non-`ArrayBuffer` binary delivery.
- Queue and recovery diagnostics identify the affected opaque lane and precise
  resource transition without including terminal content.
- Sustained output that never becomes completely idle cannot pin a terminal on
  **Loading terminal**; bounded checkpoint attempts continue until one commits,
  and every start, retry, completion, timeout, and terminal failure is observable.
- Thousands of pre-provider PTY callbacks publish only semantic activity
  transitions, keep the renderer connection open, and do not prevent another
  terminal from being created.
- Thousands of agent-status snapshots produced while a Codex journal is
  replayed coalesce or resynchronize within their subscription lane, keep the
  renderer connection open, and do not prevent another terminal from being
  created.

## Non-goals

- A terminal display is not required to paint every obsolete intermediate
  frame after it falls behind; it is required to converge to the correct
  bounded screen and scrollback state.
- Terminal presentation does not become an unbounded transcript store.
- Local transport does not receive an unlimited-memory exemption.
- This feature does not change recording retention, presentation ownership, or
  terminal-session authorization policy.
