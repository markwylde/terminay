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

Congestion is not reported as a transport failure. Increasing a global queue,
silently dropping raw frames, replaying from an arbitrary byte suffix, and
closing the shared application connection are not valid recovery strategies.

## PTY-derived state projections

Terminal activity is current state, not one durable event per PTY callback.
Raw output refreshes the server-owned inactivity deadline, but repeated output
that leaves status, attention, acknowledgement, authority, and source
unchanged does not advance the public activity revision or `updatedAt`.
Semantic transitions remain ordered and replayable.

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

`connected → reconnecting → resubscribing → hydrating → connected`.

The renderer visibly marks mounted terminal panels as reconnecting and rejects
unsafe mutations promptly while the old client is unusable. Desktop supplies a
fresh server-scoped MessagePort; browser and remote hosts establish a fresh
authenticated transport. The client never reuses a half-closed connection.

After reconnecting, the client reloads the authoritative workspace snapshot,
resubscribes feature projections from confirmed revisions, and reattaches each
mounted terminal from its confirmed position or a fresh checkpoint. Recovery
uses bounded retry with backoff and remains active until it succeeds, the user
selects another connection, or the window closes. A failed recovery is visible
and actionable; the application never remains silently mounted with disposed
terminal clients.

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
- Congestion across UTF-8, CSI, OSC, DCS, alternate-screen, resize, and
  synchronized-output boundaries restores a presentation equivalent to the
  canonical checkpoint and later live stream.
- Forced Local MessagePort, WebSocket, and WebRTC failures automatically
  reconnect, reload workspace state, and hydrate existing terminal panels
  without duplicating PTYs, output, input, or workspace mutations.
- Queue and recovery diagnostics identify the affected opaque lane and precise
  resource transition without including terminal content.
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
