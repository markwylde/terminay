## 1. Desktop-owned launcher

- [x] 1.1 Add `docker/terminay-bot/bin/terminay-app` service/client with bounded argv protocol, owner-only socket, clean desktop environment, independent streams, bounded logs, child reaping, and actionable errors; verify fake-app tests cover malformed/oversized requests, literal metacharacters, unavailable executables, credentials exclusion, crash diagnostics, and subsequent launch availability.
- [x] 1.2 Wire the helper into `terminay-init` and Dockerfile with event-driven readiness; verify init tests and a locally built image expose the helper as bot without published ports or automatic application restart.
- [x] 1.3 Preserve execution-capability and work-lease checks for launch dispatch through both native CLI paths; verify absent/revoked capability and absent work ownership reject requests while authorized requests launch successfully.

## 2. Bot guidance and lifetime explanation

- [x] 2.1 Update `packages/server-core/src/botService/memories.ts` with application launch syntax, diagnostics, screenshot verification, and reuse of open windows; verify instruction tests retain the browser helper and distinguish acceptance from visual success.
- [x] 2.2 Update the session process-group explanation to include desktop-owned applications; verify its UI test states Stop retains desktop apps and stopping the bot container ends them.

## 3. Lifecycle verification

- [x] 3.1 Add regression tests using a persistent fake app and a session-owned command: after completion, Stop, suspension, timeout, and crash, verify the app survives and session cleanup still ends the command; verify explicit close does not relaunch and container stop ends the app.
- [x] 3.2 Run targeted server-core bot init, supervision, prompt, and native driver tests using their repository runners; record commands/results and preserve existing browser open-once, URL dispatch, and closed-browser behavior.
- [x] 3.3 Build a disposable bot image/container and use Gridcraft to enter an unsaved workbook in one execution and add a sum in the next; inspect fresh screenshots after the first execution closes and after the second edit, and record evidence that the same workbook remains open. Verify Stop also preserves it. Do not modify the user's live bot for this check.
- [x] 3.4 Run affected Electron E2E coverage through `npm run test:e2e` in Docker, covering the lifetime explanation and visible app continuity where feasible; record actual results and any remaining manual gate.

## 4. Specification review

- [x] 4.1 Reconcile overlapping bot delta requirements with `add-terminay-bots` and `adopt-atlas-bot-runtime` before spec sync; verify no browser, credential, work-ownership, or session cleanup requirement is lost.
- [x] 4.2 Review the proposed desktop ownership ADR against implementation evidence and resolve its open items without editing accepted ADRs; verify the manifest references the final record.
- [x] 4.3 Run `openspec validate --all` and change validation; record outcomes, distinguishing pre-existing failures. Keep implementation and planning in this worktree and leave archive to the explicit archive workflow.
