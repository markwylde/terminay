## 1. Interaction signal

- [x] 1.1 Make `HomeWorkspace.openBot` send a bot focus request on every open, and make `HomeTabChip` send one on a pointer press on a bot tab. Document in `botFocus.ts` that a request means the user asked for the bot. Verified by typecheck and the e2e scenario in 3.1.
- [x] 1.2 In `BotTab.tsx`, count interaction: every bot focus request, and every pointer press or key press captured inside the tab root. Pass the count to `BotChat`. Verified by the e2e scenario in 3.1.

## 2. Acknowledgement

- [x] 2.1 In `BotChat.tsx`, acknowledge through the latest loaded sequence only when the interaction count has moved past the last one handled, Chat is `here`, and history has loaded. Remove acknowledgement on visibility and on arrival. Leave the divider and read position as they are. Verified by the e2e scenario in 3.1.

## 3. Verification

- [x] 3.1 Update the bot notification scenario in `e2e/bots.spec.ts`. A reply that arrives while Chat is visible and the user does nothing raises a row after the settle period. Clicking into the Chat clears it. Opening the bot from its sidebar row clears it. Activating the notification row clears it. A press in Configure does not. Verified by `npm run test:e2e -- e2e/bots.spec.ts` passing in Docker.
- [x] 3.2 Run `openspec validate --all`, `npm run lint`, and `npm run typecheck`. Verified by each command's output.
- [ ] 3.3 Pull request checks green. Verified by reading back every commit status on the head SHA.
