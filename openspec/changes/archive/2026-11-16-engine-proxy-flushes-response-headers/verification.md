# Review and verification — engine-proxy-flushes-response-headers

Verified on 2026-11-16 against `git diff main...HEAD`, `git diff`, and the change's proposal, design, ADR manifest, tasks, and bot-engine-proxy delta.

## Requirement and scenario coverage

| Spec item | Evidence |
| --- | --- |
| Response status and headers forwarded as soon as the engine sends them | `response.flushHeaders()` after `writeHead()` in the upstream `response` handler of `docker/terminay-bot/bin/terminay-engine-proxy.mjs`. |
| Scenario: Attached run | `bot-engine-proxy.real.test.mjs` "real Docker CLI attached run and start --attach complete through the proxy": Docker 26.1.5 CLI, `docker run --rm` prints `proxy-run-ok`, `docker create` + `docker start --attach` prints `proxy-attach-ok`, exit code 0, no owned container left. With the flush removed, the same test is killed at its 60 s `docker run` deadline and its cleanup removes the stuck Created container. |
| Scenario: Quiet stream | `bot-engine-proxy.test.mjs` "wait and quiet stream response headers reach the client before the engine sends a body" covers `POST /containers/{id}/wait` and `GET /events`. With the flush removed it times out at 10 s. |
| Scenario: Engine fails after sending headers | `bot-engine-proxy.test.mjs` "engine failure after flushed headers truncates the response without a second status": the client gets 200 and the partial body, then an aborted response, with no appended JSON error. |
| Scenario: Build, logs and interactive exec (unchanged) | Existing streaming, upgrade, legacy-hijack, and buffered-body upgrade tests pass. The upgrade path is unchanged: it relays the engine's head as raw bytes. |

## Boundary review

The change is confined to the bot container's engine proxy. Attribution, connection and size limits, logging, and the whole-engine access recorded in ADR-0094 are unchanged. No Electron privilege, project/window, or terminal-session boundary is touched. No new ADR is needed.

## Validation

- `timeout 180 node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-engine-proxy.test.mjs`: 11 passed.
- Real engine (`BOT_PROXY_REAL_ENGINE_SOCKET=/var/run/docker.sock`, `BOT_PROXY_DOCKER_BIN=/usr/bin/docker`, `BOT_PROXY_TEST_IMAGE=terminay-e2e:local-amd64`): attached-run test passed; the existing Compose/Podman test skipped (no Compose binary on this host).
- `biome lint` on the three changed files: clean.
- `openspec validate engine-proxy-flushes-response-headers`: valid.
- `openspec validate --all`: 119 passed, 8 failed. The same eight failures occur on main (add-terminay-bots, bot-chat-image-attachments, linked-folders, one-window-one-server, outbound-bot-triggers, phone-review-fixes, server-notification-manager, unified-settings-window).
- Codex implementation review: no actionable findings.

## Not covered here

Rolling out the rebuilt bot image is out of scope. The real-engine test is opt-in and does not run in pull-request CI.
