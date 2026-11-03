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
