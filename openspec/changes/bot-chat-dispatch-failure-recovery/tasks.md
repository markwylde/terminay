## 1. Protocol and client

- [x] 1.1 Add `retry: 'bots.messages.retry'` and `dismiss: 'bots.messages.dismiss'` to `BOT_MESSAGE_OPERATIONS`, and optional `attempt?: number` and `dismissed?: boolean` to `BotMessage['dispatch']` in `packages/protocol/src/botMessages.ts`. Verified by `npx turbo run build --filter=@terminay/protocol` succeeding.
- [x] 1.2 Add `retry(botId, messageId, revision, attempt)` (returns `{ message, sessionId?, error? }`) and `dismiss(botId, messageId, revision, attempt)` (returns the message) to `BotMessagesClient`. Verified by the client-core build and the UI tests in 3.3.

## 2. Server

- [x] 2.1 Factor the start-and-record tail of `postUserMessage` into a private method that records `started` or `failed` with the attempt number. Verified by existing post tests still passing.
- [x] 2.2 Add `retryUserMessage(botId, messageId, revision, attempt)`. Inside `serialize`, it refuses with `conflict` unless the message is a user message whose dispatch is `failed`, not dismissed, at that revision and attempt. It then writes `pending` with `attempt + 1` and runs the shared tail. Verified by the tests in 2.5.
- [x] 2.3 Add `dismissDispatchFailure(botId, messageId, revision, attempt)` with the same guard, writing the failure with `dismissed: true`. Verified by the tests in 2.5.
- [x] 2.4 Register `bots.messages.retry` and `bots.messages.dismiss` in `messageProtocol.ts` behind `data()` / `assertBotAuthority`. Retry records the requesting viewer as post does. Change the start-failure and restart texts to say "retry". Verified by the tests in 2.5.
- [x] 2.5 Add server-core tests (the bot message / composition suites):
  - retry success links a new execution, bumps the attempt and posts no message;
  - retry failure keeps `failed` with the new reason and attempt;
  - concurrent retries naming one attempt: exactly one is accepted, with both a starting and a failing engine;
  - a late retry naming an old attempt is refused;
  - a stale revision is refused;
  - retry or dismiss of a started, pending, dismissed or bot message is a conflict;
  - a message ID from another bot is not found;
  - dismiss sets `dismissed`, emits `message.dispatch`, and survives a reload of the message store;
  - deleting the message during a retry does not bring it back;
  - a pending retried message is reconciled to `started` when its execution exists and to `failed` otherwise, with no new start.

  Verified by those tests passing under `node --test --test-force-exit --test-timeout=120000`.

## 3. Chat UI

- [x] 3.1 In `BotChat.tsx`, show a warning only for a user message whose dispatch is `failed`, not `dismissed`, and with no later user message whose dispatch is `started`. Verified by the UI tests in 3.3.
- [x] 3.2 Add Retry and Dismiss buttons to each warning, sending the message's revision and attempt. Disable them while the action runs, show refusals in the composer error area, and update the message from the response and events. Verified by the UI tests in 3.3.
- [x] 3.3 Extend `scripts/bots-ui-harness.tsx` and `scripts/bots-ui.test.mjs`:
  - the warning is hidden after a later started message;
  - Dismiss calls `bots.messages.dismiss` with revision and attempt, and hides the warning;
  - Retry calls `bots.messages.retry` and hides the warning on success;
  - Retry keeps the warning with the new reason on failure;
  - a dismissal arriving as an event from another client hides the warning.

  Verified by `npm run test:bots-ui` passing.

## 4. End to end

- [ ] 4.1 Add Electron E2E coverage in `e2e/bots.spec.ts` for a failed message's warning with Retry and Dismiss, and capture screenshots of the warning and of the result after each action. Verified by `npm run test:e2e` for that spec passing in Docker.
- [ ] 4.2 Run `openspec validate bot-chat-dispatch-failure-recovery` and the affected server-core, client-core and UI suites. Confirm that `openspec validate --all` reports no failures beyond the 7 pre-existing ones in other changes. Verified by those results.
