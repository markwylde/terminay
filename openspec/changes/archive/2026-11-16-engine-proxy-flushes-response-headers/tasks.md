## 1. Proxy

- [x] 1.1 Keep the fix already on this branch (commit `ead1f774`): `response.flushHeaders()` right after `response.writeHead()` in the upstream `response` handler of `docker/terminay-bot/bin/terminay-engine-proxy.mjs`, and nothing else in the proxy. Verify: the `/wait` test in 2.1 passes with the call and times out with it removed.
- [x] 1.2 Confirm the upgrade path (hijacked exec/attach) needs no change because it relays the engine's head as raw bytes. Verify: code read, and the existing "interactive exec preserves HTTP upgrade bytes" and "legacy HTTP 200 hijacked exec" tests pass.

## 2. Tests

- [x] 2.1 In `packages/server-core/test/bot-engine-proxy.test.mjs`, extend the existing "wait response headers reach the client before the engine sends a body" test so it also covers a quiet `GET /events` stream; for each, the head arrives before any body and the body then arrives intact. Verify: 3.1.
- [x] 2.2 In the same file, test that when the engine flushes a head and then drops the connection mid-body, the client gets the forwarded status, then an aborted or truncated body, with no appended JSON error and no hang. Verify: 3.1.
- [x] 2.3 In `packages/server-core/test/bot-engine-proxy.real.test.mjs`, add an opt-in test (runs when `BOT_PROXY_REAL_ENGINE_SOCKET` and `BOT_PROXY_DOCKER_BIN` are set) that runs `docker run --rm <image> echo` and `docker create` + `docker start --attach` through a proxy with the real Docker CLI, asserting output, exit status 0, and that no test container remains. Verify: `BOT_PROXY_REAL_ENGINE_SOCKET=/var/run/docker.sock BOT_PROXY_DOCKER_BIN=$(command -v docker) BOT_PROXY_TEST_IMAGE=<local image> timeout 180 node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-engine-proxy.real.test.mjs` passes, and the new test times out without the fix.

## 3. Checks

- [x] 3.1 Run `timeout 180 node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-engine-proxy.test.mjs`. Verify: all tests pass.
- [x] 3.2 Run `biome lint` (what CI runs) on the changed files, `openspec validate engine-proxy-flushes-response-headers`, and `openspec validate --all`. Verify: all pass, except `--all` failures that already exist on `main` in other changes, which are listed as unrelated.
