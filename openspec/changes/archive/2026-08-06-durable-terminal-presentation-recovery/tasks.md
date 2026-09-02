## 1. Correct lifecycle and reproduce the regression

- [x] 1.1 Make terminal-client resolution depend only on stable panel client, server id, project id, client id, and session id primitives, verified by a focused renderer test
- [x] 1.2 Separate xterm construction/disposal from attachment reconnect and from browser file-drop/project-root context and verify the emulator survives each
- [x] 1.3 Track the rendered acknowledgement cursor owned by the mounted emulator and use resume for a surviving display, verified by a resume-path test
- [x] 1.4 Add a focused renderer test proving project-root, sidebar, settings, and dimension updates preserve the same emulator and attachment
- [x] 1.5 Extend the local `CmdOrCtrl+O` then `CmdOrCtrl+R` end-to-end reproduction past 1 MiB of terminal output and assert prior content plus subsequent input remain usable

## 2. Build the checkpoint authority

- [x] 2.1 Add a transport-neutral checkpoint authority in `server-core` with injected clock/id generation and explicit resource limits, verified by focused server-core tests
- [x] 2.2 Feed raw PTY bytes and canonical resize transitions through one ordered checkpoint state queue and verify ordinary terminal subscribers are not delayed
- [x] 2.3 Serialize and pin versioned checkpoints with exact output positions and bounded active-screen/scrollback state, verified by round-trip assertions
- [x] 2.4 Dispose checkpoint state on session exit, interruption, and shutdown and expire abandoned attachment pins, verified by asserting the PTY is unaffected
- [x] 2.5 Prove the headless authority never forwards device, status, colour, cursor, focus, mouse, or window-query replies into terminal input

## 3. Add the protocol and client hydration contract

- [x] 3.1 Replace the byte-zero fresh-attach surrogate with checkpoint metadata and checkpoint-position attachment, verified by attach-path tests
- [x] 3.2 Add an exact attachment-scoped binary checkpoint query and enforce body, queue, timeout, authorization, and identity limits on the server
- [x] 3.3 Subscribe before checkpoint retrieval, buffer the tail, hydrate once, drain contiguously, and acknowledge only bytes actually written by xterm, verified by no-gap and no-duplicate assertions
- [x] 3.4 Preserve the existing lightweight resume path for a surviving emulator and keep presentation ownership, dimensions, and takeover behaviour unchanged, verified by the existing presentation suites
- [x] 3.5 Remove `presentation_unavailable` decisions based solely on complete transcript size or the 32-KiB command-header allowance and verify a large-transcript fresh attach succeeds

## 4. Verify correctness and bounds

- [x] 4.1 Round-trip checkpoints at every byte boundary around UTF-8, CSI, OSC, DCS, hyperlinks, alternate-screen, cursor/style, mouse/focus, bracketed-paste, and synchronized-output sequences
- [x] 4.2 Test output and resize arriving before pin, during serialization, between attach and subscribe, during binary fetch, during xterm write callbacks, and at the transition to live delivery, asserting no gap or duplicate
- [x] 4.3 Test authorization mismatch, token guessing, cross-session reuse, duplicate fetch, expiry, detach, exit, oversized state, parser backlog, hydration queue overflow, and transport disconnect
- [x] 4.4 Test fresh recovery after more than the server raw replay window, after more than 1 MiB and many millions of output bytes, and with multiple local and remote observers
- [x] 4.5 Measure and assert checkpoint CPU, heap, serialized size, pinned-state, and hydration-queue ceilings under hostile output at maximum supported terminal geometry
- [x] 4.6 Run focused workspace tests, native server/client suites, boundary and type checks, then the Electron scenarios only through `npm run test:e2e`
