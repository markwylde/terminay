# Verification — 2026-11-04

Implementation and planning remain in `feat/desktop-app-lifetime` at
`/Users/mark/Documents/Projects/terminay/terminay-desktop-app-lifetime`.
The user's running bot and installed Terminay application were not modified.

## Automated checks

- `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build:shared`: passed.
- `node --test packages/server-core/test/bot-init.test.mjs packages/server-core/test/bot-process.test.mjs packages/server-core/test/bot-memories.test.mjs packages/server-core/test/bot-native.test.mjs packages/server-core/test/bot-runtime-bridge.test.mjs packages/server-core/test/bot-sessions.test.mjs`: 38 passed, 3 optional engine tests skipped. Native protocol tests use fixtures, with no paid/live provider requests. Both production native shell guard scripts were exercised against the runtime bridge and actual app-launch service: missing token, missing work ownership, and revoked capability refused; authorized dispatch succeeded.
- `TERMINAY_BOT_APP_TEST_IMAGE=terminay-bot:desktop-app-lifetime TERMINAY_BOT_APP_ENGINE_SOCKET=/run/podman/podman.sock node --test packages/server-core/test/bot-init.test.mjs`: 10 passed, 1 older optional integration skipped. This opt-in test bootstraps its own disposable container, checks bot-owned mode-600 launcher socket/no published ports, runs `test_app_lifetime.py`, and stops a container with xclock running. The stopped container has no running process table. Test-owned containers are removed.
- `npm run test:bots-ui`: 46 passed, including session lifetime text.
- Built the Docker-isolated E2E image using `Dockerfile.e2e`, with the existing locally built E2E image as its dependency base. `TERMINAY_E2E_IMAGE_IS_PRELOADED=1 TERMINAY_E2E_IMAGE=terminay-e2e:desktop-app-lifetime npm run test:e2e -- e2e/bots.spec.ts --grep 'MCP|Stop ends'`: 3 passed. Includes session lifetime explanation and Stop behavior. Electron ran only inside Docker.
- Changed TypeScript/TSX/init and prompt tests pass their targeted Biome checks; `git diff --check` passes. Existing warnings in the compact runtime-bridge/UI test sources are not product failures.

## Real container and Gridcraft

`docker build -t terminay-bot:desktop-app-lifetime docker/terminay-bot` built successfully on local arm64 Podman. The image includes the production helper, startup wiring, XFCE and Gridcraft. A disposable network-isolated container used the same engine socket mount and SELinux setting as the local bot, with test-only bootstrap values, no published ports and no user home mount.

The launch execution ran `terminay-run first -- terminay-app launch gridcraft` and exited. Gridcraft continued as PID 220, parent/process group 30 (the desktop launcher). A separate `edit1` execution entered 1–5 into A1:A5 and ended. A separate `edit2` execution entered `=SUM(A1:A5)` and ended. The same PID, window and unsaved Book1 remained, displaying 15. Stopping a supervised `sleep 300` execution also retained the workbook and PID. Fresh screenshots were captured and inspected after each step:

- [After first edit and execution closure](evidence/after-edit1.png)
- [After the next execution adds the sum](evidence/after-edit2.png)
- [After Stop](evidence/after-stop.png)

The disposable container was stopped, confirmed `State.Running=false`, and removed. Unsaved state across container shutdown is intentionally not promised.

The checked-in real-process regression script separately verified completion, Stop, suspension close, timeout close, and agent SIGKILL: the app stayed alive, session-owned sleep ended, and session records retired in all five cases. Suspension and timeout use the same production supervisor close path; their server-side lifecycle mapping is covered by the session suite. Fake-app tests verify explicit app closure does not trigger reopening, literal argv, invalid/oversized frames, independent stdin, clean environment, bounded logs, crash diagnostics, and service availability after app failure. The browser open-once/explicit URL dispatch tests also pass.

## Specification and ADR review

The full stopping requirement in `add-terminay-bots` is aligned with this delta, preserving every existing scenario and adding desktop survival. `adopt-atlas-bot-runtime` contributes a separate `bot-desktop` capability; its browser profile, execution/work checks, credentials and container-boundary contracts remain unchanged. Sync/archive those prerequisite bot changes before this change. No main specs were edited or archive performed.

`openspec validate desktop-app-lifetime` passes (one advisory about a long requirement). `openspec validate --all --json` reports 74 passed, 4 failed, matching the pre-existing failures:

- `linked-folders`: omitted workflow persistence scenario.
- `one-window-one-server`: omitted workflow search scenario.
- `outbound-bot-triggers`: omitted existing event and missed-firing scenarios.
- `server-notification-manager`: omitted workflow permission scenarios.

ADR-0098's implementation gates are satisfied by the results above. Existing accepted ADRs remain unchanged. Installation requires the usual application update and bot image rebuild/recreation; the test image tag does not update the running user's environment.
