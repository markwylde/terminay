## Context

When the installed PWA is backgrounded, the phone freezes the document and
tears down or strands the WebRTC transport. On return, the session host's
resume check reads `peer.connectionState`, which is still `connected` because
the browser has not yet run an ICE consent check. The workspace calls
`probeNow()` on `visibilitychange`, but that probe uses the normal 10 second
deadline and needs two misses, so a dead transport is found 20 to 30 seconds
after the user comes back. If ICE gives up first, the host's 5 second
disconnect grace adds its own delay. The user sees a painted, frozen workspace
for that whole time.

A reconnect itself crosses two components. The session host in `terminay.com`
signals through the hosted relay, negotiates ICE, opens the lanes, and
authenticates the device and the application. The workspace bundle then says
hello and builds its workspace projections. Neither side records how long any
of this takes.

## Goals / Non-Goals

- Goal: a transport that died while the app was hidden is found within about
  1.5 seconds of the app being shown again, and recovery starts at once.
- Goal: every reconnect can be timed step by step and summarised on the
  server once the user opts in, so later optimisation works from numbers.
- Non-goal: keeping the transport alive while the app is hidden. The phone
  decides that.
- Non-goal: optimising state sync now. It already builds its projections in
  parallel. It is measured first and optimised in a later change.
- Non-goal: starting a speculative replacement alongside the resume probe.
  The owner declined it. The probe alone gets most of the gain.

## Decisions

- **A decisive resume probe, separate from the heartbeat cadence.**
  `probeNow({ deadlineMs: 1500, decisive: true })` supersedes any probe in
  flight, so a probe whose deadline was frozen cannot also count. One miss
  retires the generation. A loopback or LAN ping answers in milliseconds, and
  1.5 seconds leaves room for a phone thawing its radio and the main thread.
  A false positive costs one reconnect, about a second, not a broken session.
  The steady-state 10 second interval and two-miss limit are unchanged, so a
  busy but healthy connection is never retired by background pings.
- **The server does not wait for reflexive gathering.** werift's
  `setLocalDescription` resolves only after every local address has had up
  to five seconds to get a STUN answer, and the hosted host applied the
  browser's answer only after `startPeer` returned. The reproduction showed
  the full five seconds between `client-join` and ICE checking, with or
  without a reachable STUN server configured for loopback. `startPeer` now
  returns once the signaling state is `have-local-offer`. Gathering carries
  on behind it, candidates still trickle, and a late failure of the
  description retires the peer. werift accepts the remote description and
  starts ICE checks while gathering is still running.
- **The workspace times its own steps; the host reports its steps as
  durations.** The registry marks loss detection, attempt start, transport
  open, hello, and ready. The session host contract gains an optional
  `connectTimings()` that returns the last generation's step durations as
  bounded integers under fixed keys. Nothing else crosses the framed
  boundary, and an older host simply does not provide it.
- **The server owns the samples, behind a server setting.** The workspace
  sends one `connection.metrics.record` command after each connect, recovery,
  or answered resume probe, but only when the server's hello advertises
  `connection.metrics.v1`. The server stores a sample only while
  `remoteAccess.connectionMetrics` is on. Storing on the server means samples
  from the phone survive the PWA being evicted and can be read from Desktop
  or over MCP. The setting is under Remote Access, which MCP cannot change,
  so an agent can read the timings but cannot turn recording on.
- **Bounded JSON lines in the data root.** Samples are appended to
  `connection-metrics.v1.jsonl` and the file is compacted to the newest 2,000
  whenever it exceeds 2,500 lines. The file is rebuildable diagnostics: a
  corrupt line is skipped, never repaired. Each sample is validated field by
  field against fixed keys and integer bounds, and anything else is dropped.
  A client cannot write strings beyond a fixed failure-class vocabulary.
- **Metadata only.** A sample holds a trigger, a host kind, durations,
  attempt counts, and a failure class. It holds no client id, device id,
  session id, hostname, address, or project data, which keeps it within
  the remote-access diagnostics boundary.

## Boundaries crossed

- **Framed session host ↔ workspace bundle.** `connectTimings` is a new
  optional member of the closed host contract. It is validated as a function
  and its result is re-validated by the workspace before use.
- **Client ↔ server.** `connection.metrics.*` are connection-mechanics
  operations. `record` is accepted from any authenticated connection,
  because every client connects, and its payload is validated as untrusted
  input. `summary` and `clear` need settings read and write authority.
- **MCP.** `get_connection_metrics` is a Read Settings tool with workspace
  reach. It reads the summary and cannot record or clear.

## Risks / Trade-offs

- A server whose event loop is blocked for more than 1.5 seconds just as the
  user returns is reconnected once unnecessarily. This is accepted: the
  replacement reattaches the same sessions.
- Timings from the browser's clock are wall-clock durations. A sample
  spanning a second suspension is inflated. Samples are summarised with p50
  and p95 so one outlier does not move the picture.
