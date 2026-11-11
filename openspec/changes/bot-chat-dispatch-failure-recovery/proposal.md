## Why

When a chat message fails to start a bot execution, Chat shows a yellow warning under the transcript. The warning never goes away. It stays after the cause is fixed, after the user sends a later message that the bot answers, and after the user deletes a different message. The only way to clear it is to clear the whole chat. The user also cannot act on the warning: they must retype the failed message to try again.

The technical cause is that the warning is drawn for every message whose stored dispatch state is `failed`, and nothing ever changes that state again.

## What Changes

- Chat hides a message's start-failure warning once any later user message has started an execution.
- The warning gets a **Dismiss** control. Dismissing records that on the message on the server, so the warning stays hidden on every device and after reloads.
- The warning gets a **Retry** control. Retry starts a fresh execution for the same message, without posting a duplicate. A message whose start failed and was not dismissed is the only kind that can be retried.
- Two new bot message operations carry these actions: `bots.messages.retry` and `bots.messages.dismiss`.
- The start-failure and restart-failure texts tell the user to retry instead of sending a new message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: adds a requirement covering when a message's start-failure warning is shown, and how Dismiss and Retry behave.

## Impact

- `packages/protocol/src/botMessages.ts`: new operation names; `dispatch.dismissed` on `BotMessage`.
- `packages/server-core/src/botService/`: `messageProtocol.ts` (new commands), `service.ts` (retry reuses the post dispatch path; dismiss), `messages.ts` (dispatch writes).
- `packages/client-core/src/botMessages.ts`: `retry` and `dismiss` client methods.
- `src/workspace/bots/BotChat.tsx`: warning visibility rule and controls.
- Tests: server-core bot message tests, `scripts/bots-ui.test.mjs`, and Electron E2E coverage for the warning.
