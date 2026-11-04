## Why

Returning to a long Codex terminal can leave clicks and scrolling unresponsive while typing still works. A browser reproduction with the installed xterm packages confirms that checkpoint restoration retains mouse tracking but loses SGR encoding, directing captured mouse events into a channel Terminay does not consume; the exact trigger in the reported live session remains unconfirmed.

## What Changes

- Preserve the terminal program's mouse tracking and encoding state through fresh attachment and checkpoint recovery, including transitions back to ordinary selection and scrollback.
- Deliver both text and binary mouse reports through the existing ordered, bounded, presentation-authorized terminal input path, preserving bytes through the PTY boundary.
- Add deterministic regression coverage with synthetic terminal programs, long history, restoration, project/tab switching, and recovery. Assert actual PTY input, rather than only visible output or callback registration.
- Keep the fix independent of the foreground agent, its configuration, and session contents.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-stream-congestion-and-recovery`: Make recovery equivalence explicitly include mouse protocol state and delivery, with the same input authority and ordering as keyboard input.

## Impact

Server checkpoint generation in `packages/server-core/src/terminalService/presentationCheckpoint.ts`; shared renderer input handling in `src/components/TerminalPanel.tsx` and `terminalPanelInputQueue.ts`; existing client binary input support; byte handling in the node-pty adapter and session holder; checkpoint, input queue, holder, and Docker Electron E2E tests. No agent changes, new dependencies, transport operations, or presentation ownership rules are planned. The checkpoint remains the existing versioned escape-sequence format.
