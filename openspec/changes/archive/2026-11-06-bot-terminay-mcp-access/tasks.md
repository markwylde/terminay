## 1. Profile setting

- [x] 1.1 Add `terminayMcpAccess?: boolean` to the protocol `BotProfile` and draft, and to the client-core parser. A missing field reads `false`, and a non-boolean is rejected. Verify with tests in `packages/client-core/test/bots.test.mjs`.
- [x] 1.2 Parse and persist the field in `BotStore`, with a legacy record reading `false`. Verify with a round-trip and legacy test in `packages/server-core/test/bot-store.test.mjs`.
- [x] 1.3 Add the Profile switch under Investigate failures, with its reach copy and the hint shown while MCP is disabled, in `src/workspace/bots/BotProfilePanel.tsx` and `botsModel.ts`. Verify with a `botsModel.test.ts` case, and with the e2e check in 6.2.

## 2. Capability and permission gate

- [x] 2.1 Add `mintBot` and `revokeBot` to `ControlCapabilityStore`, with the caller key `bot:<botId>:<executionId>`, workspace reach and a `bot` principal. Verify with tests that the reach is the workspace, revoke-by-bot ends every execution of that bot, MCP disable revokes, and a revoked token's in-flight request is aborted.
- [x] 2.2 Make terminal-requiring tools return `unsupported_op` for bot callers, and make the view relay resolve no client for a bot principal, so view operations return `renderer_unavailable`. Verify with tests for `show_window` and `focus_tab` from a bot capability while a client is attached.
- [x] 2.3 In `createMcpPermissionGate`, run `ask` and `allow` for bot callers and refuse `deny` with `permission_denied`, never calling the approval service. Verify with tests for each policy, and for a policy change between two calls.

## 3. Host MCP session

- [x] 3.1 Refactor `runServerMcpStdio` into `createTerminayMcpSession({ socketPath, token, transport })`, with stdio as a thin wrapper. Verify that the existing stdio and MCP conformance tests pass unchanged.
- [x] 3.2 Build the per-connection relay handler: one lazy session for each `connection`, isolated request ids, `notifications/cancelled`, and close-on-disconnect that aborts only that connection's requests, with a cap of 16 outstanding requests per connection. Verify with tests for two connections both using id 1, a disconnect during a pending wait leaving the other connection working, and the cap.
- [x] 3.3 Add the seam `terminayMcp.open(botId, executionId, isAllowed)`, which checks `isAllowed` before and after minting. Wire it from `electron/main.ts` through `serverTerminalAuthority` into `createBotServerService`. Verify with an integration test that `tools/list` through the seam returns the workspace tool set, and that `isAllowed() === false` mints nothing.

## 4. Bot relay delivery and lifetime

- [x] 4.1 In `openBotRuntimeBridge`, when given a Terminay handler, open a second `terminay-mcp-relay` with its own id and secret. Check the secret on every frame, add the `terminay` server entry, and register the secret with the redactor and the diagnostic sanitiser. `close()` closes the handler, revokes the capability and kills the relay. Verify with `bot-runtime-bridge.test.mjs` cases for on, off, a wrong secret, and a secret split across output chunks being redacted.
- [x] 4.2 Handle partial startup failures. A failure in mint, session open or the second relay tears down whatever was set up, logs one Runner output line, and starts the execution without `terminay`. Verify with tests that fail at each point and assert no live capability or relay remains.
- [x] 4.3 Add the per-bot access generation in `BotService`. Bump it in `save()` on an on-to-off change and in `removeNow()`, followed by `revokeBot(botId)` before either returns. Execution start reads the current record and builds `isAllowed`. Verify with tests for:
  - toggle-off during a pending `wait_for_command`, where the wait is cancelled and no result arrives;
  - toggle-off racing a starting execution, which gets no `terminay` server;
  - off then on, after which the running execution stays revoked;
  - toggle-on mid-execution, where only the next execution gets access;
  - delete with two concurrent executions, which revokes both;
  - stop, timeout and replacement, each of which revokes.
- [x] 4.4 Confirm that bot operations refuse bot-execution capabilities. Verify with a test that presents one to a bot operation and is refused.

## 5. Docs

- [x] 5.1 Describe the setting where bots are covered in `docs/product-overview.md`. Verify by reading it.

## 6. Verification and finish

- [x] 6.1 Run `npm run typecheck`, `npm run lint`, and the server-core, client-core, terminay-server and renderer unit tests. Verify that all of them pass.
- [x] 6.2 Add e2e coverage, run through `npm run test:e2e`, showing that the Profile switch defaults off, saves on, and shows the hint while MCP is disabled, and capture screenshots. Verify that the suite passes.
- [x] 6.3 Run `openspec validate --all`, and run `/openspec-verify-change`. Verify that both are clean for this change.
- [x] 6.4 Archive the change so its deltas sync into `openspec/specs/`, and run `openspec validate --all --archived`. Verify that the main specs contain the new requirements.
- [x] 6.5 Open the Gitea PR and read back every commit status on the head SHA. Verify that all of them are `success` or `skipped`.
