## 1. Server store

- [x] 1.1 Add failing tests to `packages/server-core/test/agent-store.test.mjs`: `markTerminalAcknowledged` and `markAcknowledged` turn an unread `done` root into `idle` and read; an already-read `done` root is also turned `idle`; `waiting`, `blocked`, and `working` roots keep their state; a `done` subagent stays `done`. Verified by the tests failing before the change.
- [x] 1.2 Change `acknowledged()` and the entry selection in `packages/server-core/src/activity/agentStore.ts`. Verified by 1.1 passing under `npm run test:ci --workspace packages/server-core`.
- [x] 1.3 Add a test to `packages/server-core/test/agent-service.test.mjs` (or the session-source bridge test) showing that after acknowledgement an `idle` snapshot for the same finished turn keeps the root `idle`, and a later turn ending after the acknowledgement makes it `done` and unread. Verified by it passing.

## 2. Renderer store

- [x] 2.1 Mirror the same rule in `src/agentStatusStore.ts` with matching cases in `scripts/agent-status-store.test.mjs`. Verified by `node --test --experimental-strip-types scripts/agent-status-store.test.mjs` passing.

## 3. Existing expectations

- [x] 3.1 Update any unit or E2E test that asserts an acknowledged root remains `done` (e.g. `scripts/task9-agent-acknowledgement-ui.test.mjs`, `e2e/agent-status-sidebar.spec.ts`). Verified by `npm run test:e2e -- e2e/agent-status-sidebar.spec.ts` passing.

## 4. Indicator settings

- [x] 4.1 Add failing tests to `scripts/terminal-tab-agent-presentation.test.mjs` and the workspace inventory tests: with finished indicators off an unread `done` agent shows no tab glyph and is not notable; with active indicators off a `working` agent shows none and is not notable; with a terminal's own switch off a `waiting` agent shows none and is not notable; a pending MCP approval still shows. Verified by the tests failing before the change.
- [x] 4.2 Route agent states through `isTerminalActivityIndicatorStateVisible` in `src/components/TerminalTab.tsx` and `isNotableInventoryEntry`. Verified by 4.1 passing and `npx tsc --noEmit -p .` exiting zero.
- [x] 4.3 Apply the same rule to agent rows in the header Notifications list and to other servers' agent project badges. Verified by `scripts/published-notifications.test.mjs` and `scripts/multi-connection-workspace.test.mjs` covering both.

## 5. Specs and delivery

- [ ] 5.1 Run `openspec validate agent-done-clears-on-view --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all three exiting zero.
- [ ] 5.2 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
