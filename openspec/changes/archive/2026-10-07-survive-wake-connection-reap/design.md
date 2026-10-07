## Context

Diagnostics for Desktop launch `c0f3d2eb` (2026-10-07, times UTC):

| Time | Source | Event |
| --- | --- | --- |
| 08:49:28.557 | renderer | `connection-heartbeat-lost`; reconnects within 300 ms. No server-side close is logged. |
| 08:49:33 → 08:59:50 | — | No records: the machine is asleep. |
| 08:59:50.762 | main | `[server] renderer connection failed Error: application heartbeat timed out` |
| 08:59:50 → 09:00:07 | — | The person asks for a new project. |
| 09:00:07.035 | renderer | `connection-heartbeat-lost`; reconnects within 200 ms. |
| 09:00:14 | main | Clean exit: the person quit because the window was unusable. |

How the code produces that:

- `ServerConnection.noteInboundFrame` (`packages/server-core/src/connection.ts`)
  arms a `setTimeout` for `heartbeatTimeoutMs` (60 s) on every inbound frame
  from a client that advertised `connection.heartbeat`. Timers that came due
  during a sleep run as soon as the process resumes, so the server reaps the
  connection before the client has had any chance to send a frame.
  `connectionRegistry` advertises the heartbeat for every connection, the
  embedded Local one included.
- `createSessionHeartbeat` (`src/web/sessionConnectAttempt.ts`) has the same
  shape on the client: the interval doubles as the response deadline, and a
  deadline timer that comes due while the document is frozen aborts a probe
  that was never given time to be answered. Two of those retire the generation.
- The server's `transport.close()` closes its end of the Desktop
  `MessagePortMain`. The window's `ServerPortTransport` listens for the port's
  `close`, but in the reported run it stayed `open` for 17 s and the loss was
  reported by the heartbeat. Which hop drops the close — Chromium's
  cross-process port close, the preload hand-off, or
  `ServerScopedMessagePort` — is not yet established.
- `TerminayClient.commandWithBody` turns a disconnect during a command into
  `CommandOutcomeUnknownError`, whose doc comment says callers must resolve it
  with `commandStatus()`. Nothing calls `commandStatus()`, the server has no
  `command.status` operation, and the dispatcher's command ledger is keyed by
  connection id, so it cannot answer for a command sent on the previous
  connection.
- `App.tsx` `createServerProject` catches every error into
  `creationStatus: 'failed'`. While that holds, `activeProject` is forced to
  `null`, `displayedActiveProjectId` is forced to the pending tab, and `+` is
  disabled because `pendingProjectCreation !== null`.

Constraints from the in-force ADRs: ADR-0028 forbids new polls, so suspension
must be read from timers that already exist; ADR-0018 keeps hosts
protocol-blind, so nothing the Desktop host does may inspect application
frames; ADR-0011 keeps the renderer untrusted, so the server stays the only
authority on whether a project exists.

## Goals / Non-Goals

**Goals:**

- A sleep of any length does not, by itself, cost a healthy connection — on
  the embedded Local connection or any other.
- When the server does close the embedded connection, the window knows within
  a turn of the event loop, not within a heartbeat miss window.
- A project creation caught by a reconnect completes, exactly once, with no
  error shown.
- No project-creation failure can make the rest of the window unusable.

**Non-Goals:**

- A server `command.status` operation or a command ledger that outlives a
  connection. Project creation names its own `projectId`, so the resynchronised
  snapshot already answers the question. Commands that cannot be resolved that
  way are not changed here.
- Changing the heartbeat interval, the miss limit, or the 60 s server deadline.
- Faster detection of a remote (WebRTC or WebSocket) transport that really did
  die during a sleep. It keeps today's miss-limit bound.
- The `Uncaught (in promise) ClientDisconnectedError: client is closing`
  console errors that every reconnect logs. They are noise from callers that do
  not handle a closing client and deserve their own change.

## Decisions

### 1. A late deadline is a suspension, and a suspension buys one fresh deadline

Both heartbeat timers record the wall-clock time at which they were armed. When
the timer fires, the overshoot is `Date.now() - armedAt - deadline`. An
overshoot above a tolerance means the measuring side was not running for part
of the deadline, so the deadline proves nothing about the peer.

- Server (`noteInboundFrame`): instead of failing the connection, re-arm one
  full deadline. If the client is alive, its next probe arrives within one
  heartbeat interval and re-arms the timer normally. If it is not, the fresh
  deadline fires on time and the connection is reaped as today.
- Client (`createSessionHeartbeat`): a probe whose deadline fired late is not
  counted as a miss; the next probe is sent immediately rather than after an
  interval.

The tolerance is `min(5 s, deadline / 2)`, configurable through the same
options object that already carries the deadline, so tests can use millisecond
deadlines. The check costs one subtraction in a callback that already runs; it
adds no timer, which keeps it inside ADR-0028.

The error is one-sided by construction. A forward clock step or a long
event-loop stall looks like a suspension and delays a reap by one deadline. A
backward clock step gives a negative overshoot and changes nothing. No input
makes either side retire a connection sooner than it does today.

Alternatives considered:

- *Have Electron's `powerMonitor` tell the server about suspend and resume.*
  It only helps Desktop, not the standalone server or a browser tab, and it
  routes an OS signal through the privileged boundary to fix something each
  side can observe for itself.
- *Stop the embedded Local connection promising a heartbeat.* The 17 s in
  which the window's transport read `open` over a closed endpoint is exactly
  the case the heartbeat exists for. Removing it would leave that case with no
  detector at all.
- *Use a monotonic clock that excludes sleep.* Node and Chromium do not agree
  across platforms on whether their monotonic clocks advance during sleep, so
  the behaviour would differ by OS. Comparing wall-clock elapsed time against
  the deadline detects the same thing everywhere.

### 2. The window observes the server's close of the Desktop byte endpoint

The first implementation task establishes, in the Docker E2E harness, which hop
drops the close. The fix then takes the first of these that the evidence
supports:

1. Wire the port's `close` through whichever hop loses it, so
   `ServerPortTransport.fail` runs in the window when the server closes. This
   is what the code already intends and needs no new contract.
2. If Chromium does not deliver `close` to a renderer port whose peer was a
   `MessagePortMain`, the Desktop host tells the window which byte endpoint
   closed, over the host bridge it already uses for endpoint hand-off. The
   message names the endpoint and carries nothing else.

Either way the Desktop host stays protocol-blind (ADR-0018): it reports that an
endpoint it handed out has closed, which it knows without reading a frame. The
signal crosses the privileged boundary from main to renderer only, and the
renderer gains no capability from it — it can already close its own endpoint
and ask for a replacement.

Alternative considered: *an application-protocol "closing" frame sent by the
server before it closes.* It would need a protocol addition and would still not
cover a server that dies without sending it. Transport lifecycle belongs to the
transport.

### 3. Project creation resolves an interrupted command from the resynchronised snapshot

`createServerProject` treats a lost connection (`unknown_command_outcome` or
`disconnected`) as "not known yet" rather than "failed":

1. Keep the pending tab in its loading state.
2. Wait for the connection that owns the project to be ready again, and for
   its workspace store to resynchronise. A reconnect builds a new client
   context and a new `WorkspaceSnapshotStore`, so the wait is on the connection
   registry for that server id, not on the old store.
3. If the snapshot has `projectId`, carry on to terminal launch. If it does
   not, send `createProject` again with the same `projectId`.
4. Apply the same rule to the terminal-launch step: after a reconnect, launch
   a terminal only if the project has none.
5. Give up after three interrupted attempts, or when the connection becomes
   unreachable or incompatible, and fail the tab with a plain message
   ("Couldn't confirm the project was created. Check the connection and try
   again."). No command or session identifier is shown.

The decision logic lives in a small pure function beside
`projectTabModel.ts` so it is testable without React. `projectId` is chosen
once per request and reused on every resend, which is what makes a resend safe:
the server rejects a duplicate id, and the client only resends after the
snapshot has shown the id absent.

The server remains the authority (ADR-0011). The client does not assume the
project exists; it reads the server's snapshot.

Alternative considered: *implement `command.status` and a ledger keyed by
client rather than connection.* It is the general answer and the doc comment on
`CommandOutcomeUnknownError` already promises it, but it is a protocol and
persistence change with its own questions about retention and about two
connections sharing one device id. Identity-in-snapshot resolves the reported
case and every other create-with-client-id command today.

### 4. A failed pending tab is an ordinary selectable tab

`isPendingProjectFailure` stops overriding the active project. The pending tab
is added to what can be selected; a creation failure selects it, as the spec
already requires, and selecting any other tab or Home works as it does for a
real project. The error view renders only while the failed tab is the selected
one. `+` is disabled only while a creation is in flight, not while one has
failed; starting a new creation replaces the failed tab. The failed tab's body
gains Retry and Dismiss actions; Retry re-enters `createServerProject` with the
same label and a new `projectId`.

## Risks / Trade-offs

- [A server that dark-wakes for a few seconds every few minutes never runs a
  full deadline, so a truly dead remote client stays attached until the machine
  stays awake for one deadline] → The cost is that connection's attachments and
  leases held a little longer. They are connection-scoped, and the client is
  reaped on the first full deadline after the machine stays awake.
- [The tolerance treats a 5 s event-loop stall as a suspension] → That is the
  intended reading: a server that could not run for 5 s could not have read a
  probe either. The effect is one deadline of delay before a reap.
- [Resending `createProject` could create a second project] → It is resent only
  after a resynchronised snapshot shows the id absent, with the same id, and
  the server rejects a duplicate id. A test drives both orderings.
- [Decision 2 cannot be pinned without real Electron] → Its first task is a
  failing E2E spec in the Docker harness; the choice between the two mechanisms
  is made from what that spec shows and recorded in `tasks.md`.
- [Decision 4 touches the tab-selection path that the Home and project tab
  specs depend on] → The existing `e2e/project-tabs.spec.ts` suite runs
  unchanged, plus new cases for the failed tab.

## Migration Plan

No data, protocol, or settings migration. All four decisions are independent
and can land in one pull request or separately; each is covered by its own
tests. Rolling back is reverting the commit.

## Open Questions

- Which hop loses the Desktop endpoint close (decision 2). Answered by task 2.1.
- No in-force ADR needs revisiting.
