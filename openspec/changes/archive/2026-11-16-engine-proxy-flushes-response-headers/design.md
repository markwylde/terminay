## Context

Each bot container runs `terminay-engine-proxy.mjs`, which serves `/var/run/docker.sock` and forwards to the engine's daemon-side socket (ADR-0094). Ordinary requests go through `http.request` to the engine; on the engine's `response` the proxy calls `response.writeHead(status, headers)` and pipes the body. Upgrade requests (exec/attach with `Upgrade: tcp`) take a separate raw-socket path that writes the request line and headers itself and pipes bytes both ways.

Node's `ServerResponse.writeHead()` only records the head; it is sent with the first `write()`/`end()`. Any engine response whose headers come well before its body is held at the proxy. `/containers/{id}/wait` is the one the CLI blocks on before continuing, which deadlocks attached runs.

The change stays inside the bot container's proxy. It crosses no new boundary: the proxy still grants the same whole-engine access (ADR-0094), and nothing about attribution, limits or logging changes.

## Goals / Non-Goals

**Goals:** attached `docker run`, `docker start --attach` and attached Compose complete through a bot's socket; every ordinary response's head reaches the client when the engine sends it; the change stays minimal.

**Non-Goals:** rolling out the new bot image; changing the upgrade path, timeouts, or attribution.

## Decisions

- **Flush the head right after `writeHead`, for every ordinary response.** `response.flushHeaders()` sends the status line and headers immediately. Applying it to all responses (not only `/wait`) keeps the proxy transparent for the other responses whose body can lag behind their headers: `/events`, `logs?follow=1` on a quiet container, `stats`, and build/pull progress. For responses with an immediate body it only splits the head into its own write. Alternative considered: special-casing `/wait`. Rejected because the same delay hides the head of every quiet stream, and path matching adds API-version parsing for no benefit.
- **Leave the upgrade path alone.** Hijacked exec/attach (101, and Docker's 200-with-hijack) are relayed as raw bytes from the engine socket, so the engine's head reaches the client exactly when the engine sends it. Verified by reading the code and by the existing "interactive exec preserves HTTP upgrade bytes" test.
- **Error handling is unchanged.** Node sets `headersSent` as soon as `writeHead()` runs, so `fail()` already destroyed (rather than appended a JSON error to) any response whose head had been written. Flushing changes only when the client receives the head, not that branch. If the engine drops the connection mid-body, the client now sees the forwarded status followed by a truncated response and a closed connection, never a hang or a second status.

## Risks / Trade-offs

- [One extra small write per proxied response] → negligible next to Docker API traffic; correctness of the attached flow outweighs it.
- [Synthetic tests could pass while the real CLI still deadlocks] → an opt-in real-engine test drives `docker run --rm` and `docker start --attach` through the proxy with the real Docker CLI.
- [Fix only takes effect after the bot image is rebuilt] → rollout is tracked outside this change.
