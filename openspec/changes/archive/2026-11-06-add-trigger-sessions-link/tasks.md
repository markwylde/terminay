## 1. Server filter

- [x] 1.1 Add optional `triggerId` to `sessions.list` in `packages/server-core/src/botService/sessions.ts`, matching non-chat origins by their recorded trigger id. Verify with a unit test: given chat, trigger A firing, trigger A Run now, and trigger B sessions, `triggerId: A` returns exactly A's two sessions, newest first; combined with `origin: 'run-now'` it returns one; an unknown id returns none.
- [x] 1.2 Pass `triggerId` through the `bots.sessions` handler in `botProtocol.ts`. Verify with a unit test that a second bot's trigger id returns no sessions for the first bot.
- [x] 1.3 Add `triggerId` to the `sessions` filter type in `packages/client-core/src/bots.ts`. Verify with the repository typecheck.

## 2. Sessions tab filter

- [x] 2.1 Give `BotSessionsPanel` `trigger?: { id; name }` and `onClearTrigger` props. Send `triggerId` in the query, render a removable "Trigger: <name>" chip with `data-terminay-bot-sessions-trigger`, and reset the selection when the trigger changes. Verify with the e2e in 4.1.
- [x] 2.2 In `BotTab`, hold the trigger filter state, pass it to `BotSessionsPanel`, and clear it when the user chooses the Sessions tab header and when `subscribeBotFocus` opens a specific session. Verify with the e2e in 4.1 (header clearing) and 4.2 (focus clearing).

## 3. Trigger actions

- [x] 3.1 Add a Sessions icon button to each `BotTriggersPanel` row, with `data-terminay-bot-trigger-sessions`, calling a new `onShowSessions({ id, name })` prop. Verify with the e2e in 4.1.
- [x] 3.2 Add a Sessions button to the `BotTriggerEditor` footer, shown only for a saved trigger, with `data-terminay-bot-trigger-editor-sessions`. Verify with the e2e in 4.2, which also checks that the new-trigger sheet has no Sessions button.
- [x] 3.3 Wire `onShowSessions` from `BotTab` to set the filter, reset the selected session, and switch to the Sessions tab. Verify with the e2e in 4.1.

## 4. Verification

- [x] 4.1 Extend `e2e/bots.spec.ts` with a test that creates triggers A and B, runs each with Run now, and sends a chat message. It then chooses Sessions on A's row and asserts that only A's session is listed with the chip. It sets the outcome filter, removes the chip, and asserts that the outcome filter is kept and every matching session is listed. It reapplies A's filter, chooses the Sessions tab header, and asserts that the chip is gone. Verify with `npm run test:e2e`.
- [x] 4.2 In the same suite, open B's saved sheet and choose Sessions, asserting the filter is B. Assert that the New trigger sheet has no Sessions button. Then open a session of A through bot focus, for example from the context rail's recent sessions, and assert that the chip is cleared and that session is selected. Verify with `npm run test:e2e`.
- [x] 4.3 Run lint, typecheck, the unit tests, and `openspec validate --all`. Verify that lint, typecheck and the unit tests pass and that this change validates. Any `openspec validate --all` failure in another active change that also fails on `main` is recorded as pre-existing, not introduced here.
