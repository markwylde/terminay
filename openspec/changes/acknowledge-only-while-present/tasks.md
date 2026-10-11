## 1. Definition

- [x] 1.1 Give the definition of the terminal the user is interacting with the focus of its window, in `src/workspace/terminalActivityAcknowledgement.ts`
- [x] 1.2 Use it for the activity snapshot path and for the `notifications.probe` answer in `src/App.tsx`, judging a terminal by the document its panel is in

## 2. Verification

- [x] 2.1 Unit tests for the definition with and without window focus
- [x] 2.2 End-to-end test: a notification sent from the terminal the user typed in is shown once they have left the window
- [ ] 2.3 Pull request checks green
- [ ] 2.4 Confirmed on a paired phone: a notification sent while the user is in another application arrives as a banner
