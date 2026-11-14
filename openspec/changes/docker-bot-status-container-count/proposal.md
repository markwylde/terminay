## Why

On a Linux server with rootful Docker, the Bots dashboard says "The container engine is not running or cannot be reached" and shows "No engine" and "0 / 0 running", even though Docker is running, reachable, and already selected. Bots cannot be created or started from that state. The same dashboard works on macOS with Podman.

The engine check itself succeeds, and the saved engine selection is rewritten each time. The status read then counts bot containers with a label-negation filter (`label!=terminay.helper`). Podman's compatibility API accepts that filter. Docker rejects it with `400 invalid filter 'label!'`, so the whole `bots.engine.status` read fails, and the server reports that 400 as "not running". Reproduced against Docker 26.1.5 (API 1.45) on Debian 13.

## What Changes

- Container listing over the engine socket sends only filters that both Docker and Podman accept. Label-negation filters (`label!=key` and `label!=key=value`) are applied by the server to the labels the engine returns, rather than being sent to the engine.
- The bot-container count on the Bots dashboard no longer counts helper containers on either engine, and the status read succeeds on Docker.
- The fake engine socket used by the server tests rejects filter keys Docker does not support, so a Podman-only filter fails in tests rather than in production.

Out of scope: how the server maps other engine HTTP errors to user-facing reasons, and whether a failed container count should reject the whole status read. Neither is needed to fix this report.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-container-engine`: adds the requirement that container listing uses only filters both engines accept, with server-side label exclusion, so engine status reads succeed on Docker.

## Impact

- `packages/server-core/src/botService/socketDriver.ts`: `container ls` translation.
- `packages/server-core/src/botService/engineService.ts` keeps its `label!=terminay.helper` argument unchanged; the driver now honours it on both engines.
- `packages/server-core/test/fixtures/bot-socket-server.mjs` and server-core bot tests.
- No protocol, client, or UI change. No new dependency.
