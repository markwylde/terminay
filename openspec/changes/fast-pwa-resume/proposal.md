## Why

Switching back to the installed PWA after a minute away leaves the workspace
looking connected and doing nothing for up to 30 seconds before it even tries
to reconnect, even with phone and server on the same Wi-Fi. The phone suspends
the app and the transport dies while it is suspended, but nothing reports it.
The peer still says `connected`, no lane has closed, so the session host
keeps the generation. The workspace's heartbeat is the only thing left to
notice, and it gives each ping 10 seconds and needs two misses in a row.

Once a reconnect does start, there is no record of where its time goes, so
there is nothing to optimise against and no way to tell, after a few days of
use, whether returning to the app is actually fast.

## What Changes

- Returning to the foreground sends one resume probe with a 1.5 second
  deadline. A single missed resume probe retires the generation and starts
  recovery at once. Steady-state heartbeats are unchanged.
- The server hands a new peer to signaling as soon as its offer is in place,
  instead of once candidate gathering ends. The runtime gives each local
  address five seconds to reach STUN, so an address that cannot reach it
  (loopback, a VPN, a container bridge, no internet) put five seconds into
  every handshake, because the browser's answer waited behind the gather.
- The session host reports how long each step of its last connect took
  (signaling, ICE, lanes, device authentication, application
  authentication) to the workspace. These are durations only.
- A new server setting, **Record connection timings** (Remote Access, off by
  default). While it is on, each connection the workspace makes or
  recovers, and each resume probe that is answered, is recorded on the
  server as one metadata-only timing sample: what triggered it, how long the
  app was hidden, how long detection took, the host's steps, the hello, the
  workspace sync, the total, and how many attempts it needed. The server
  keeps the most recent 2,000 samples in its data root.
- A new read-only MCP tool, `get_connection_metrics`, summarises those
  samples (count, mean, p50, p95, and max per step, broken down by trigger)
  and lists the most recent ones, so the numbers can be checked after a
  few days of use. Settings > Remote shows the same summary and can clear it.
- A reproduction in the hosted end-to-end suite (`terminay.com`) silences
  the WebRTC lanes without closing them, then suspends and resumes the
  document, the way a phone does, and requires a live replacement
  generation within a few seconds of the resume.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-access`: heartbeat liveness gains the resume probe; connection
  timing metrics are added.
- `mcp-permissions`: `get_connection_metrics` joins Read Settings.
- `mcp-app-control`: the `get_connection_metrics` tool.

## Impact

- `src/web/sessionConnectAttempt.ts`, `src/shared/connections/connectionRegistry.ts`,
  `src/web/main.tsx`: the resume probe, connect timing marks, and sending samples.
- `src/web/sessionTransportHost.ts`: optional `connectTimings` on the host contract.
- `packages/protocol`: the `connection.metrics.v1` capability and sample types.
- `packages/server-core/src/connectionMetrics/`: the bounded sample store and
  the `connection.metrics.*` operations, composed by the standalone server
  and Desktop's embedded server.
- `src/terminalSettings.ts`, server settings defaults: `remoteAccess.connectionMetrics`.
- `src/components/SettingsWindow.tsx`: the summary under the setting.
- `apps/terminay-server/src/mcp/`, `electron/main.ts`: the MCP tool.
- `terminay.com` (separate repository and pull request): the session host
  records its connect steps and exposes `connectTimings`, and a silent-death
  resume reproduction joins `specs/e2e/session-reconnect.test.mjs`.
