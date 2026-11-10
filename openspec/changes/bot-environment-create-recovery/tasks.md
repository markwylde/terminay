## 1. Server

- [x] 1.1 In `BotEnvironmentService.create`, on a `conflict` from container create, inspect the name; rethrow if a container is listed, otherwise ask the driver for the leftover, remove it by identifier and create once more. Verify with the new case in `packages/server-core/test/bot-environment.test.mjs`: one removal by identifier, two creates, state `running`; a name that stays refused fails after exactly one retry; no leftover or a failed lookup removes nothing.
- [x] 1.3 Add `leftover` to `EngineDriver` and implement it in `SocketDriver` for Podman from the external container listing. Verify with the driver case in the same file: exact name and `storage` state only, and no request on Docker.
- [x] 1.2 Add a `conflict` message to `engineMessages` in `failure.ts`. Verify with an assertion on `botFailure` in the same test file.

## 2. Bot tab

- [x] 2.1 Render the environment condition in `BotRecovery` as an alert with title, detail, primary action and inline failure reason, driven by a pure `recoveryNotice` function in `botsModel.ts`. Verify with unit cases in `botsModel.test.ts` for not created, failed, out of date and healthy.
- [x] 2.2 In Environment › Overview, label the primary action by outcome and add **Create environment** and unavailable-action reasons to the Actions menu. Verify with `npm run lint` and the type check.

## 3. Checks

- [x] 3.1 Run `npm run lint`, the server-core bot environment tests and the bots model tests.
- [x] 3.2 Run `openspec validate bot-environment-create-recovery`.
