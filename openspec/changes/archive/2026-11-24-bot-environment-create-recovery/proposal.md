## Why

A bot whose container had been removed could not be brought back. Podman had dropped the container but kept its storage, which still held the name `terminay-bot-<id>`. The engine listed no such container, so Terminay showed the bot as not created, yet every create was refused with a name conflict. Sessions failed, and Terminay reported only "The container engine operation failed".

The bot tab made this hard to act on. The one working action, **Create environment**, was a small unstyled button above the tabs with no explanation beside it. Environment › Overview said the machine was not created but offered only **Start**, and its Actions menu showed **Restart** and **Recreate** greyed out with no reason and no create action.

## What Changes

- Creating a bot container removes storage that a removed container left behind under the bot's name, by that storage's own identifier, then creates once more. Nothing is removed by name, so a container that holds the name is never touched.
- A name conflict from the engine gets its own message, naming the conflict and the way out, instead of the general engine failure text.
- The bot tab shows an environment that needs the user as an alert: a warning when it is not created or its image is out of date, an error when it failed. The alert names the bot, says what happens next, carries the action as its primary button, and shows a failed attempt's reason inside itself.
- Environment › Overview names its primary action for what it does: **Create environment** when there is no container, **Try again** after a failure, **Start** when stopped. Its Actions menu offers **Create environment** when there is no container, and an action that cannot run says why.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: container creation recovers a bot name held by leftover engine storage, and Environment › Overview offers a create action and explains unavailable actions.
- `bot-engine-recovery`: an environment that needs the user is shown as an alert that carries its own action and failure reason.

## Impact

- `packages/server-core/src/botService/environment.ts`: one retry of container creation after removing leftover storage.
- `packages/server-core/src/botService/engine.ts`, `socketDriver.ts`: an optional `leftover` driver operation, answered for Podman.
- `packages/server-core/src/botService/failure.ts`: a message for engine conflicts.
- `src/workspace/bots/BotRecovery.tsx`, `BotEnvironmentPanel.tsx`, `botPanels.css`: the alert, the Overview action labels and the Actions menu.
- Tests: `packages/server-core/test/bot-environment.test.mjs`, `src/workspace/bots/botsModel.test.ts`.
