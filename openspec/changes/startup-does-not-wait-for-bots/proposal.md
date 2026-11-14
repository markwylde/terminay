## Why

Terminay Desktop can sit on "Preparing projects" for a minute after launch. On
14 November the canary's built-in extensions were ready 1.5 seconds after
launch, and the server became ready 61.6 seconds later. Nothing else in startup
took more than a second.

That minute is the server waiting for the container engine. Server startup
awaits `bots.reconcile()`, which asks Docker or Podman for the engine, the bot
image, and each bot's container, with request deadlines of 5 to 30 seconds. An
engine that is slow to answer, for example while its VM wakes, holds every
project and terminal behind bots the user may not be using.

## What Changes

- Server startup no longer waits for bot reconciliation. It starts
  reconciliation, carries on, and becomes ready without it.
- Bot triggers start once reconciliation finishes, as before, just no longer on
  the startup path.
- A bot execution requested before reconciliation finishes waits for it, as it
  already does.
- Shutdown waits for a reconciliation still in flight, and triggers never start
  after shutdown begins.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `bot-environment`: the "Container lifecycle" requirement's startup
  reconciliation runs without delaying server readiness.

## Impact

- Code: `start()` and `shutdown()` in `packages/server-core/src/composition.ts`.
- Tests: `packages/server-core/test/server-composition.test.mjs` (new),
  `packages/server-core/test/bot-composition.test.mjs` (setup waits for
  reconciliation).
- No protocol, UI, settings, or dependency changes.
