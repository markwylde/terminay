# Remote generation set

## Goal

Retired hosted WebRTC generations leave the live peer set. After ~20 minutes
of reconnects, a new connect still hydrates a checkpoint and then streams
later PTY. Device signaling refresh at 20 minutes does not accumulate closed
peers.

## Governing specifications

- [Remote access](../features/remote-access.md)

## Scope

- [x] `HostedGenerationSet` drops on lifecycle fail; `closeAll` on host stop
- [x] Reconnect-storm test keeps only the live generation
- [x] Device refresh delay is 20 minutes after register

## Definition of done

`hosted-generation-set.test.mjs` passes. Closed Werift peers are not retained
in Electron until process exit.
