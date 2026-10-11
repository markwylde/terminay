## 1. Client

- [x] 1.1 Remove arrival-time acknowledgement from the activity snapshot path in `src/App.tsx`, with the last-interacted-terminal state and `src/workspace/terminalActivityAcknowledgement.ts`
- [x] 1.2 Remove the `notifications.probe` answer from `src/App.tsx` and `onProbe` from `packages/client-core`

## 2. Server

- [x] 2.1 Remove the `notifications.probe` event and the manager's sent-listener from `packages/server-core/src/notifications`

## 3. Verification

- [x] 3.1 Server protocol and manager tests pass without the probe
- [x] 3.2 End-to-end: work finishing in the terminal the user is in stays until they click into it; a notification sent from that terminal is shown when they do nothing, and never shown when they type inside the settle period
- [ ] 3.3 Pull request checks green
- [ ] 3.4 Confirmed on Desktop and a paired phone: an agent finishing in the terminal just typed in raises the Dock badge and a banner
