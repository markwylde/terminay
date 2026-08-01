# Server terminal service

## Goal

Move PTY lifecycle and terminal streaming into Terminay Server with resumable
multi-client subscriptions and exact server/project/session authorization.

## Governing specifications

- [Terminal workspace](../features/terminal-workspace.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

PTY hosts run as Node children, but Electron owns their maps, routes output to
one renderer, and kills sessions with `webContentsId`. The server cannot yet
keep a terminal alive across client reload, window close, or remote reconnect.

## Dependencies

- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)

## Work slices

### PTY ownership

- [x] Keep concrete node-pty loading behind a window-independent server
  adapter; server-core tests prove one process survives subscription detach
  and resumes from a known output position.
- [x] Move spawn configuration, child supervision, cwd/process inspection,
  input, resize, kill, exit, and shutdown into server-core. `TerminalService`
  owns the PTY process and immutable terminal identity; its canonical snapshot
  now includes `cwd`, pid, dimensions, replay state, and exact exit metadata.
  `ServerTerminalAuthority` derives cwd from that server snapshot rather than
  retaining a second host copy. Focused terminal/protocol/composition suites
  (14 tests) and `npm run build:app` pass.
- [x] Assign immutable server/project/session ownership at creation.
- [x] Remove PTY lifetime from Electron renderer/window destruction. Destroyed
  web contents now detach subscriptions and mark only the legacy compatibility
  owner as detached; they do not kill a terminal. The production default is
  the server-owned `ServerTerminalAuthority`.
- [x] Represent exit and server-restart interruption exactly once.

### Streams and replay

- [x] Provide a transport-neutral server attachment adapter with per-client
  session high-water marks, detach/resume, and retained-replay gap errors;
  the client facade below uses the same identity and cursor contract.
- [x] Add per-session output positions, bounded replay snapshots, subscriber
  cursors, and duplicate suppression.
- [x] Implement attach/detach/resume over `TerminayClient`; the transport-neutral
  `TerminayTerminalClient` facade exercises canonical terminal commands and
  subscriptions with stale-cursor duplicate suppression.
- [x] Bound queued output and define slow-consumer disconnect/resync.
- [x] Preserve raw output bytes for xterm, recording, activity parsing, and
  other authorized consumers without double capture. Terminal adapter,
  input-source, and PTY lifecycle tests pass with exact byte assertions,
  recording capture, activity parsing, and duplicate-suppressed replay.

### Input and dimensions

- [x] Route keyboard, paste, macro, dictation, MCP, and remote writes through
  one authorized input boundary with backpressure.
- [x] Define terminal-size ownership when several clients attach, including
  release, stale clients, and narrow/mobile viewers.
- [x] Reject input/resize/kill for exited, stale, cross-project, or
  cross-server sessions.

### Compatibility

- [x] Define and test a transport-neutral `TerminayTerminalPanelClient`
  attachment contract that preserves raw xterm bytes and routes input, resize,
  kill, and acknowledgement through the exact terminal attachment.
- [x] Add an opt-in Desktop `TerminalPanel` path that attaches/resumes through
  that contract, preserves the existing xterm surface, and keeps preload as a
  compatibility fallback until host wiring is complete.
- [x] Add a compatibility-only `DesktopTerminalAuthorityAdapter` for the
  remaining non-panel terminal input/resize/kill path; it forwards immutable
  server/project/session identity through `TerminayTerminalClient` and rejects
  renderer/window ownership fields.
- [x] Adapt the existing Desktop terminal panels to the terminal client
  contract without changing xterm behaviour. `TerminalPanelClientContext`
  supplies the stable shared client and project identity to Dockview panels;
  `scripts/terminal-panel-context.test.mjs` exercises a real attachment, while
  `scripts/terminal-panel-migration.test.mjs` keeps the preload branch bounded.
- [x] Keep splits, search, clipboard, paste, links, drops, zoom, styling, note,
  and exit UX intact.
  - [x] Keep OSC-8 and detected-web-link activation on the shared terminal UI
    path with pointer affordance, duplicate-handler suppression, and a handled
    external-open failure that permits an immediate retry
    (`scripts/terminal-link-interaction.test.mjs`).
  - [x] Keep terminal selection copy independent of the terminal transport: an
    empty selection does not call the clipboard, and a denied clipboard write
    is handled without an unhandled rejection so a later selection can be
    copied immediately (`scripts/terminal-clipboard-interaction.test.mjs`).
  - [x] Keep shared terminal paste independent of terminal transport: only
    non-empty text is handed to xterm (and therefore its existing `onData`
    route), malformed clipboard values do not create user input, and a denied
    clipboard or xterm paste failure refocuses the terminal so a later paste
    can proceed (`scripts/terminal-paste-interaction.test.mjs`).
  - [x] Keep portable explorer/text path drops on the shared terminal path
    while fencing raw `File`-object path resolution behind the explicit
    Desktop compatibility branch. A server-backed/browser panel neither calls
    Desktop preload nor claims raw file drops it cannot resolve
    (`scripts/terminal-drop-interaction.test.mjs`).
  - [x] Keep in-buffer terminal search on the platform shortcut: `Cmd+F` on
    macOS and `Ctrl+F` on other desktop platforms, while excluding mixed or
    extended modifier chords so they remain available to the host/shell
    (`scripts/terminal-search-interaction.test.mjs`).
  - [x] Keep terminal notes isolated from terminal input while providing an
    unmodified `Escape` route back to the exact terminal; modified Escape
    chords and ordinary note editing remain available to the editor/host
    (`scripts/terminal-note-interaction.test.mjs`).
  - [x] Keep terminal zoom presentation-safe on the shared terminal path:
    finite positive/negative zoom adjusts xterm font size, all values retain
    the readable six-pixel minimum, and malformed host values cannot corrupt
    terminal options (`scripts/terminal-zoom-interaction.test.mjs`).
  - [x] Keep terminal appearance on the shared terminal path: applying live
    xterm settings, a tab-theme colour, or host zoom composes presentation-only
    options without mutating saved settings or touching terminal transport
    (`scripts/terminal-presentation-interaction.test.mjs`).
  - [x] Keep terminal switching on the shared terminal path: only non-repeating
    `Alt+Tab` and `Alt+Shift+Tab` are claimed for next/previous terminal
    navigation, while extended modifier chords remain available to the host and
    shell (`scripts/terminal-switcher-interaction.test.mjs`).
  - [x] Keep terminal exit presentation on the shared path: a configured
    successful normal exit suppresses its stale failure line, while failed or
    signalled exits retain their exact xterm notice; malformed runtime metadata
    is rendered as `unknown`, never `NaN` or `Infinity`
    (`scripts/terminal-exit-interaction.test.mjs`).
  - [x] Keep literal multiline terminal input on the shared client path: only
    non-repeating `Shift+Enter` or `Alt+Enter` becomes bracketed-paste newline
    input for the exact terminal attachment; ordinary, mixed, and extended
    modifier chords remain available to the shell or host
    (`scripts/terminal-multiline-interaction.test.mjs`).
  - [x] Keep terminal clear presentation-only and scoped to the exact live
    terminal session: malformed, missing, or cross-session clear events cannot
    clear another attachment; a valid clear restores focus without emitting
    terminal input or using terminal IPC (`scripts/terminal-clear-interaction.test.mjs`).
  - [x] Keep split-terminal focus restoration scoped to the exact terminal that
    received a fresh window-activation pointer event: stale, future, or
    malformed activation timestamps cannot steal focus from another split, and
    recovery remains presentation-only (`scripts/terminal-focus-interaction.test.mjs`).
  - [x] Keep terminal scrollback navigation on the shared terminal path: only
    non-repeating, unmodified `Shift+PageUp`, `Shift+PageDown`, `Shift+Home`,
    and `Shift+End` move the local xterm viewport; they never send terminal
    input, while extended modifier chords remain available to the shell or host
    (`scripts/terminal-scrollback-interaction.test.mjs`).
  - [x] When an authenticated protocol client disconnects, release only that
    client's terminal viewport lease immediately. The next authorized client
    can resize the same live server-owned PTY without waiting for lease expiry;
    `packages/server-core/test/terminal-protocol.test.mjs` proves the handoff.
  - [x] The normal attachment-detach path releases that same client viewport
    lease immediately. Closing a panel or switching server therefore cannot
    leave a dead client blocking the next authorized terminal attachment;
    `packages/server-core/test/terminal-protocol.test.mjs` proves the handoff.
- [x] Remove terminal application IPC after the Local client uses the server
  transport.
  - [x] Server-backed panel teardown closes its bounded input queue and
    detaches the exact server attachment without killing the server-owned
    session or calling legacy terminal IPC (`scripts/terminal-panel-migration.test.mjs`).
  - [x] Dockview panel removal now fences `window.terminay.killTerminal` behind
    the explicit compatibility branch; server-backed workspaces rely on the
    panel attachment detach path and do not call legacy kill IPC
    (`scripts/terminal-panel-migration.test.mjs`).
  - [x] Server-backed workspace creation routes normal new-terminal and
    open-at-folder flows through write-scoped `terminal.create`; the server
    assigns the session identity and owns its cwd/dimensions
    (`terminal-protocol.test.mjs`, `terminal-client.test.mjs`, and
    `npm run test:terminal-panel-context`).
  - [x] Remove the server-backed `TerminalPanel` replay/data fallback. An
    attachment failure now closes the attachment input queue and renders an
    actionable error; it cannot fall through to `getTerminalBuffer`,
    `onTerminalData`, or `onTerminalExit` preload IPC. The no-regression
    boundary is asserted by `scripts/terminal-panel-migration.test.mjs`.
  - [x] Fail closed after a server-backed terminal write, resize, or
    acknowledgement failure. The attachment and ordered input queue are
    detached rather than sending later input with an unknown delivery order;
    the panel exposes an explicit **Retry connection** action that creates a
    fresh attachment from the client's retained replay boundary, never a
    stale UI cursor. `resync_required` advances the terminal-client watermark
    to `replayFrom`; focused coverage lives in
    `packages/client-core/test/terminal-panel.test.mjs`,
    `scripts/terminal-panel-input-queue.test.mjs`, and
    `scripts/terminal-panel-context.test.mjs`.
  - [x] Recover a retained-output replay gap by detaching the invalid
    attachment, clearing the ambiguous xterm buffer, and resuming from the
    server-provided `replayFrom` cursor with a fresh ordered input queue. This
    stays entirely on the terminal client contract and is covered by
    `scripts/terminal-panel-migration.test.mjs`.
  - [x] Fail closed when the server reports a retained-output replay gap. A
    `resync_required` event detaches the affected server terminal attachment
    instead of leaving a partially replayed terminal interactive; Desktop
    exposes **Retry connection** and the shared web surface requires reopening
    the panel. Covered by `scripts/terminal-panel-migration.test.mjs`.

### Tests

- [x] Exercise real shells in standalone and embedded modes.
- [x] Test replay positions, retained-buffer gaps, duplicate suppression,
  backpressure, slow clients, disconnect, exit, and shutdown.
- [x] Test two simultaneous clients with competing resize and input.
- [x] Exercise a real `/bin/sh` through the server's `createNodePtyFactory`
  seam; standalone and embedded application harnesses remain open above.
- [x] Preserve terminal UI E2E coverage through the client contract. The
  production renderer connector test drives `TerminayTerminalPanelClient`
  across the framed MessagePort into the server composition and verifies raw
  bytes, acknowledgement, input, resize, and detach.

## Acceptance checks

- A PTY survives client reload, disconnect, and native-window close while the
  server remains alive.
- Reconnect resumes from a known output position without duplicate PTY creation
  or acknowledged output.
- Two clients observe one exit event.
- Input and resize affect only the exact authorized live session.
- No Electron window or renderer id determines PTY ownership.

## Definition of done

Terminay Server is the sole PTY and terminal-stream authority. Desktop and web
surfaces are detachable clients with no process ownership.
