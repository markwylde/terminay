## 1. Client

- [x] 1.1 Limit arrival-time acknowledgement to terminals no agent owns and to a focused window, in `src/workspace/terminalActivityAcknowledgement.ts` and the activity snapshot path of `src/App.tsx`; end the interaction when activity arrives while the user is away
- [x] 1.2 Send that acknowledgement as passive; add `passive` to `acknowledge` in `packages/client-core`
- [x] 1.3 Remove the `notifications.probe` answer from `src/App.tsx` and `onProbe` from `packages/client-core`

## 2. Server

- [x] 2.1 Accept `passive` on `activity.acknowledge` and do not report it as interaction
- [x] 2.2 Remove the `notifications.probe` event and the manager's sent-listener

## 3. Verification

- [x] 3.1 Unit tests for the definition: agent terminal, window focus, focus moved on
- [x] 3.2 Server test: a passive acknowledgement clears a bell and leaves a sent notification, and an ordinary one then removes it
- [x] 3.3 End-to-end: a shell command finishing after the user left the window is announced and survives their return; a notification sent from the terminal the user is in is shown when they do nothing and never shown when they type inside the settle period
- [x] 3.4 Pull request checks green
- [ ] 3.5 Confirmed on Desktop and a paired phone: an agent finishing in the terminal just typed in raises the Dock badge and a banner

### Audit evidence — 2026-11-04

Read back every head status on [PR #385](https://git.i.wylde.net/markwylde/terminay/pulls/385), `46a35e5079d788af33cfdf4e86037f95794d90fd`: all 26 are success or skipped. Separate unchecked manual or external-repository checks remain open.
