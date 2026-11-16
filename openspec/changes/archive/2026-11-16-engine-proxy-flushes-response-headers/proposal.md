## Why

Inside a bot, any attached container command hangs forever with no error and no timeout: `docker run` (attached or `--rm`), `docker start --attach`, and attached `docker compose up`. Detached commands (`docker run -d`, `docker create` + `docker start`) work. Bot executions that build or test through Docker freeze silently, and each hung attempt leaves a container stuck in Created (issue #619).

The cause is the bot's engine proxy (`docker/terminay-bot/bin/terminay-engine-proxy.mjs`). It calls `response.writeHead()` when the engine's response arrives, but Node does not put headers on the wire until the first body write. The engine answers `POST /containers/{id}/wait?condition=next-exit` with headers at once and no body until the container exits. The Docker CLI waits for those headers before it sends `/start`, so the container never starts, never exits, and the CLI waits forever.

## What Changes

- The proxy flushes each ordinary (non-upgrade) response's status line and headers to the client as soon as the engine sends them, before any body.
- Regression tests prove `/wait` headers reach the client before the engine sends a body, that a quiet streaming response (`/events`) does the same, and that an engine failure after the head yields a truncated response rather than a hang.
- An opt-in real-engine test runs `docker run --rm` and `docker start --attach` with the Docker CLI through the proxy.
- The `bot-engine-proxy` spec states that response headers are forwarded without waiting for a body, with an attached-run scenario.

Out of scope: rebuilding the bot image and restarting bot containers to roll the fix out, and any change to the upgrade (hijacked exec/attach) path, which already forwards raw bytes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-engine-proxy`: "Bounded transparent HTTP transport" requires response headers to reach the client as soon as the engine sends them.

## Impact

- `docker/terminay-bot/bin/terminay-engine-proxy.mjs`: one `response.flushHeaders()` call after `writeHead` in the upstream response handler.
- `packages/server-core/test/bot-engine-proxy.test.mjs`: regression tests.
- `packages/server-core/test/bot-engine-proxy.real.test.mjs`: opt-in real-engine attached-run test.
- Bot image: takes effect when the image is rebuilt and bot containers restart. Desktop use and CI do not go through this proxy and are unaffected.
