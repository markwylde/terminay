## 1. Chat

- [x] 1.1 Per-bot read position in `src/workspace/localViewState.ts`, bounded and best-effort
- [x] 1.2 `BotTranscript` renders each Chat message as its own block with avatar, author and time when given message meta; Sessions unchanged
- [x] 1.3 Unread divider in `BotChat`, fixed for the visit, opening at the divider when the unread run overflows
- [x] 1.4 Mark read on leaving Chat, unmount, window hidden, and on send

## 2. Rail

- [x] 2.1 `distinctUpcoming` in `triggersModel.ts`, with unit tests
- [x] 2.2 Fetch a wider upcoming page and show each trigger once with a repeat mark

## 3. Verification

- [x] 3.1 Typecheck, lint, unit tests
- [x] 3.2 Run the app and check Chat and the rail by eye (Docker E2E: new test plus all 19 bots tests pass; screenshot reviewed)
- [ ] 3.3 Pull request checks green
