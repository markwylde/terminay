# Workspace session connect coalescing

## Goal

Make the server-bundled workspace share the session host's current WebRTC
generation. Initial connect, automatic recovery, and Retry are one in-flight
attempt. A retired generation cannot start a second connect that closes a
just-hydrated client.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

Related history: Task 42 introduced `RendererConnectionController` and did not
wire it into `src/web/main.tsx`.

Depends on: hosted `terminay.com` Task 2 (session `connect` uses the current
generation and publishes lifecycle the workspace can subscribe to).

## Current gap

`src/web/main.tsx` calls `sessionHost.connect({ onStateChange })`, but the
hosted `connect` ignores those options. Recovery is an ad-hoc
`recoverConnection` flag that the *initial* connect does not set. Any
`closed` from a retiring bootstrap generation can start a parallel connect
that disposes the client that just painted the terminal. After that,
`recoveryInFlight` can block further Retry if `connect()` hangs.

## Implementation slices

- [x] Treat workspace `connect` as acquisition of the current session-host
      generation. Do not start a second signaling join from the workspace.
- [x] Subscribe to the transport endpoint or session-host lifecycle after
      connect returns. Ignore `closed` / `failed` from a retired generation.
- [x] One in-flight attempt covers first mount, automatic recovery, and
      Retry. Overlapping `connect()` is impossible. A hung attempt has a
      bounded deadline and returns to retry-wait.
- [x] Drive reconnecting UI from that attempt. A painted workspace whose
      client was disposed cannot remain marked connected.

## Acceptance checks

- Emitting `closed` for a retired generation during first hydration does not
  start a second connect or unmount a still-current client.
- Retry during an in-flight attempt is coalesced, not a competing join.
- After a real current-generation failure, Retry creates one fresh attempt
  and live terminal input resumes without reload.

## Definition of done

Renderer-focused tests prove coalescing and stale-close ignore. This file
moves to `tasks_completed/`.
