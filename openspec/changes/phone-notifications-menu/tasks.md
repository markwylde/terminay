## 1. Renderer

- [x] 1.1 Add the Notifications control and its count to `CompactChromeRow`
- [x] 1.2 Add the sheet to `TerminalActivityOverview.tsx`, sharing the wide list's rows
- [x] 1.3 Show the sheet on a compact workspace from the shell's existing open state; style it in `App.css`

## 2. Verification

- [x] 2.1 End-to-end: the bell counts, the sheet lists a sent notification with its title and message, Clear all empties it, choosing a row goes to the terminal and clears it, and the sheet and the switcher are never shown together
- [ ] 2.2 Pull request checks green
- [ ] 2.3 Confirmed on a phone
