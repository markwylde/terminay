## 1. PTY ownership

- [x] 1.1 Keep concrete node-pty loading behind a window-independent server adapter, verified by server-core tests proving one process survives subscription detach and resumes from a known output position
- [x] 1.2 Move spawn configuration, child supervision, cwd/process inspection, input, resize, kill, exit, and shutdown into server-core, verified by the focused terminal/protocol/composition suites (14 tests) and `npm run build:app` passing
- [x] 1.3 Assign immutable server/project/session ownership at creation and verify identity cannot be reassigned
- [x] 1.4 Remove PTY lifetime from Electron renderer/window destruction, verified by a destroyed web contents detaching subscriptions and marking only the legacy compatibility owner as detached
- [x] 1.5 Represent exit and server-restart interruption exactly once, verified by two simultaneous clients observing one exit event

## 2. Streams and replay

- [x] 2.1 Provide a transport-neutral server attachment adapter with per-client high-water marks, detach/resume, and retained-replay gap errors, verified against the client facade's identity and cursor contract
- [x] 2.2 Add per-session output positions, bounded replay snapshots, subscriber cursors, and duplicate suppression, verified by stale-cursor tests
- [x] 2.3 Implement attach/detach/resume over `TerminayClient`, verified by `TerminayTerminalClient` exercising canonical terminal commands and subscriptions with stale-cursor duplicate suppression
- [x] 2.4 Bound queued output and define slow-consumer disconnect/resync, verified by slow-consumer tests
- [x] 2.5 Preserve raw output bytes for xterm, recording, activity parsing, and other authorized consumers without double capture, verified by terminal adapter, input-source, and PTY lifecycle tests with exact byte assertions

## 3. Input and dimensions

- [x] 3.1 Route keyboard, paste, macro, dictation, MCP, and remote writes through one authorized input boundary with backpressure and verify each source uses it
- [x] 3.2 Define terminal-size ownership when several clients attach, including release, stale clients, and narrow/mobile viewers, verified by competing-resize tests
- [x] 3.3 Reject input/resize/kill for exited, stale, cross-project, or cross-server sessions, verified by rejection tests for each case
- [x] 3.4 Release a client's viewport lease immediately on authenticated disconnect, verified by `packages/server-core/test/terminal-protocol.test.mjs` proving the next authorized client can resize the same live PTY without waiting for expiry
- [x] 3.5 Release the same client viewport lease immediately on normal attachment detach, verified by the same protocol test so closing a panel or switching server cannot block the next attachment

## 4. Compatibility

- [x] 4.1 Define and test a transport-neutral `TerminayTerminalPanelClient` attachment contract preserving raw xterm bytes and routing input, resize, kill, and acknowledgement through the exact attachment
- [x] 4.2 Add an opt-in Desktop `TerminalPanel` path that attaches/resumes through that contract, preserves the existing xterm surface, and keeps preload as a bounded compatibility fallback
- [x] 4.3 Add a compatibility-only `DesktopTerminalAuthorityAdapter` for the remaining non-panel input/resize/kill path and verify it rejects renderer/window ownership fields
- [x] 4.4 Adapt existing Desktop terminal panels to the client contract without changing xterm behaviour, verified by `scripts/terminal-panel-context.test.mjs` exercising a real attachment and `scripts/terminal-panel-migration.test.mjs` keeping the preload branch bounded
- [x] 4.5 Keep link activation, clipboard copy, paste, path drops, search, notes, zoom, appearance, switching, exit presentation, multiline input, clear, split focus, and scrollback intact on the shared terminal path, each verified by its focused `scripts/terminal-*-interaction.test.mjs` suite
- [x] 4.6 Remove terminal application IPC after the Local client uses the server transport, verified by `scripts/terminal-panel-migration.test.mjs` asserting no legacy terminal IPC call from the server-backed path
- [x] 4.7 Route server-backed new-terminal and open-at-folder flows through write-scoped `terminal.create`, verified by `terminal-protocol.test.mjs`, `terminal-client.test.mjs`, and `npm run test:terminal-panel-context`
- [x] 4.8 Fail closed after a write, resize, or acknowledgement failure by detaching the attachment and input queue and exposing **Retry connection**, verified by `packages/client-core/test/terminal-panel.test.mjs`, `scripts/terminal-panel-input-queue.test.mjs`, and `scripts/terminal-panel-context.test.mjs`
- [x] 4.9 Recover a retained-output replay gap by detaching, clearing the ambiguous xterm buffer, and resuming from the server-provided `replayFrom` cursor with a fresh ordered input queue, verified by `scripts/terminal-panel-migration.test.mjs`

## 5. Tests

- [x] 5.1 Exercise real shells in standalone and embedded modes and verify terminal behaviour matches
- [x] 5.2 Test replay positions, retained-buffer gaps, duplicate suppression, backpressure, slow clients, disconnect, exit, and shutdown
- [x] 5.3 Test two simultaneous clients with competing resize and input
- [x] 5.4 Exercise a real `/bin/sh` through the server's `createNodePtyFactory` seam
- [x] 5.5 Preserve terminal UI end-to-end coverage through the client contract, verified by the production renderer connector test driving `TerminayTerminalPanelClient` across the framed MessagePort into the server composition and checking raw bytes, acknowledgement, input, resize, and detach
