# Remote hydrate stall grace

## Goal

A remote generation that dumps a checkpoint then pauses outbound while
handshake inbound continues is not failed. Stall fail waits for hydrate
grace. Peer-closed logs name the stall.

## Governing specifications

- [Remote access](../features/remote-access.md)

## Scope

- Recreate the 2026-08-31 08:22 Desktop log: 185 outbound frames, then a 4s
  outbound pause, then handshake inbound, `outbound-stalled`, generation
  closed, reconnect. That must not fail.
- Fail `outbound-stalled` only when first outbound is older than hydrate
  grace (15s).
- Classify peer-closed `outbound-stalled` / required-lane close.

## Definition of done

`hosted-hydrated-checkpoint-silence.test.mjs` covers the 4s handshake pause
and the post-grace fail. Desktop `reasonClass` is not `other` for those
fails.
