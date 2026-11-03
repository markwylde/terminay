# Verification

Implementation and planning are on `fix/bot-engine-recovery`, per the explicit request to use one branch. Archive follows merge.

## Automated checks

- Server/client bot suites: 218 passed, 6 opt-in real-engine tests skipped. New lifecycle tests also pass, covering missing homes, disposed event subscriptions and deletion while process cleanup cannot reach the engine.
- Browser UI: 45 passed, including per-bot outage/identity recovery and confirmed engine selection.
- `npm run test:e2e -- e2e/bots.spec.ts`: 12 passed in Docker, including the outage banner, deletion with a deferred-resource warning, reset at the same socket for old/new bots, first-chat image creation and the two-bot helper/event regression. The API fixture emits real-shaped container lifecycle events. The loop test distinguishes home-size helpers from socket-permission probes, observes exactly two home-size helpers for opening Overview plus Refresh, and verifies no additional helpers appear afterward while dashboard filtering remains responsive.
- TypeScript checks pass. Repository lint completes with existing warnings.
- `openspec validate --all`: 104 passed, zero failed.
- Archive-inclusive validation: 204 passed; four existing failures in `2026-09-06-agent-provider-status-conformance`, `2026-10-07-notifications-icon-and-project-dot`, `2026-10-10-macros-script-editor`, and `2026-10-27-github-worktree-status`.

## Real MCP startup

`TERMINAY_BOT_MCP_SMOKE_IMAGE=terminay-bot-recovery-smoke:local node --test packages/server-core/test/bot-runtime-real.test.mjs` passes against the local rootful Podman engine on macOS.

The temporary smoke image derives from the installed bot image, copies the current shipped `terminay-bot-mcp` and `terminay-mcp-relay` scripts into `/usr/local/bin`, and sets their mode to 0755 as the production Dockerfile does. The test starts a fresh container with networking disabled, checks runtime readiness, calls `chat_list` through the real shipped Python adapter, and creates a session using the real installed Claude ACP binary. Claude connects to the MCP runtime during session creation. No model prompt or personal credential is used. The temporary container is removed after the test.

The original in-session MCP failure was not independently reproduced after removing the event loop. Startup now explicitly checks adapter connectivity and preserves bounded redacted relay/adapter errors, including failures during teardown. Runtime credentials remain execution-bound, and adapter startup does not inherit the shell work-lease guard.

## Visual recovery check

The reset test saves `engine-reset-recovery.png` and `engine-reset-recovered.png` in its Playwright output. Inspection found that a full fleet summary clipped the adoption button inside the bot banner. The bot view now uses a compact summary, omits stale image metrics while the engine is unavailable, and asserts that the entire Use this engine button is in view before interacting with it. Browser UI checks also pass after this change.

Deletion rejects new messages and profile changes while confirmed removal is pending, so another request cannot restart work during cleanup. Its regression test passes.

## CI correction

The first PR run exposed an existing device-sign-in test waiting on the old completed execution after sending a new message. It now waits for the returned fresh execution before checking restored credential configuration. This preserves the message-log contract and removes the race.

Final required Gitea statuses are read from the PR head before handoff.


## Socket ownership follow-up

The prior real-container check was optional in workspace CI and asserted neither socket ownership nor actual numeric process users. The earlier green CI result did not establish this boundary.

The follow-up explicitly assigns a root-created socket to pwd.getpwnam('bot'), keeps 0600, and rejects a privileged bot account. Root-owned supervisor process-group bookkeeping is preserved. The diagnostic for failed adapter preflight instructs rebuilding the image and recreating the environment.

The new real test fails against the original `terminay-bot:local` image in its direct-root case with an MCP adapter connection failure. Against an image generated afresh by planBotImage from the production Dockerfile, current scripts and pinned Claude contribution, all three cases pass: supervised relay ownership and real Claude ACP startup, direct-root relay ownership and bot-user chat_list/chat_post calls, and a deliberately root-only socket rejected by bot-user preflight with permission-denied stderr. Numeric kernel users and mode are asserted; these are not mocked ownership checks. The required command completes with three passes and zero skips.

`npm run test:bots:mcp-real` builds that complete image and a bundled test harness, mounts the daemon-side Unix socket into the harness, and sets both the image and REQUIRED flag. Missing image configuration cannot silently skip the required tests. On local rootful Podman the invocation uses `TERMINAY_BOT_MCP_DAEMON_SOCKET=/run/podman/podman.sock`; Docker CI uses /var/run/docker.sock, including when the job's Docker CLI uses a TCP daemon connection.

Host-only framing fixtures are explicitly synthetic account tests, separate from the required real-container ownership tests. A chat execution regression injects a permission failure into the preflight and asserts Failed state, adapter stderr, and no agent launch. The Docker-isolated Electron Bots suite passes all 12 tests. Gitea adds the unconditional Bot MCP real-container ownership job; its result is verified before handoff.


The required Gitea job ran on PR #482 (run 23125, job 68712): all three real-container tests passed, zero failed and zero skipped. The Electron suite now includes a 13th case that injects EACCES through the Docker-compatible exec API and asserts that the built/bundled application's Chat path records Failed, displays the MCP cause and adapter stderr, and never launches the agent. All 13 Electron tests pass in Docker. The workflow policy tests now require the bot ownership job and prohibit making it conditional or allowed to fail. The final PR head is checked again before handoff.

## Claude shell-prefix follow-up

The prior container test launched Claude without its contributed launchEnvironment and counted arbitrary runtime assertions as connection evidence. A failed runtime/check-work could therefore satisfy it. Direct adapter preflight and socket ownership did not establish the agent's launch path. The ticket identifies a separate deterministic bootstrap cycle and token stripping in terminay-tool-shell.

The prefix now execs only the exact fixed no-argument adapter command (including whole-string single/double quoting) before work acquisition. It strips provider credentials and BASH_ENV but retains the execution token for that adapter. Other commands, suffixes, metacharacters and extra arguments remain gated; allowed shell commands still lose credentials and runtime tokens. The bot service injects only terminay_bot, and no arbitrary stdio server command gains an exemption.

The bridge requires authenticated initialize and tools/list on the same connection before an execution can be Completed. Direct preflight and work checks do not satisfy this requirement. A missing handshake becomes an actionable Failed session with Runner output; empty adapter stderr no longer produces an empty startup diagnostic.

Local verification on rootful Podman:

- `TERMINAY_BOT_MCP_DAEMON_SOCKET=/run/podman/podman.sock npm run test:bots:mcp-real`: 6 passed, 0 failed, 0 skipped. The image is built from the server's staged/shipped context and its fingerprint must match source. The actual pinned Claude contribution, BotAgentProcess, ACP/SDK, shell prefix, Python adapter, relay and bot service are exercised.
- The complete chat case sends hi through BotService, performs Claude ToolSearch discovery when offered, calls chat_list and work_acquire, runs Bash with stripped credentials, calls chat_post, verifies a durable bot reply and Completed state, and checks the transcript for startup errors. Only the model HTTP responses and lifecycle preparation of the already-created test container are fixture-controlled; tools and message persistence are real.
- The negative control restores the original pre-fix shell gate inside a disposable container. Direct runtime preflight succeeds, actual provider startup invokes the real work gate, and provider completion is converted to Failed with MCP diagnostics. This verifies this ticket's failure, not an unrelated forced process exit.
- Exact-command tests cover unquoted/single/double-quoted adapter launches, retained token, stripped provider credentials, work acquisition remaining unclaimed during bootstrap, denied ordinary/near-match/extra-argument commands, and successful stripped shell execution after acquisition.
- `node --test packages/server-core/test/bot*.test.mjs`: 212 passed, 0 failed, 12 optional cases skipped. The mandatory container command above runs all 6 real cases without skipping.
- `npm run test:e2e -- e2e/bots.spec.ts`: 14 passed in Docker, including the bundled UI showing Failed and actionable Runner output when a provider silently completes without MCP tools.
- `npm run lint`: no errors. Active OpenSpec validation: 104 passed, 0 failed. Archived validation: 204 passed, 4 existing incomplete-task failures, unchanged from the prior follow-up.

No live Anthropic account was used: `claude auth status` reports loggedIn false. The deterministic model endpoint allows complete real-adapter/tool/chat coverage in required CI without external credentials; this is not a claim that a live model response was verified.

Final Gitea statuses are read back on the PR head before handoff.
