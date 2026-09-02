## Context

See proposal.md. This change ran after the standalone and embedded server
runtime existed, and it is the first service to move its complete ownership out
of Electron.

## Goals / Non-Goals

Goals:
- Terminay Server is the sole PTY and terminal-stream authority.
- Desktop and web surfaces are detachable clients with no process ownership.
- Existing terminal UX — splits, search, clipboard, paste, links, drops, zoom,
  styling, notes, exit presentation — is preserved exactly.

Non-Goals:
- Changing xterm behaviour or the visual terminal surface.
- Removing the legacy compatibility path in one step; preload stayed available
  as a fallback until host wiring was complete.

## Decisions

**Identity is immutable and assigned at creation.** Server, project, and
session ownership are fixed when the terminal is created. No Electron window
id, renderer id, or `webContentsId` participates in PTY ownership. Destroying a
web contents detaches subscriptions and marks only the legacy compatibility
owner as detached — it does not kill a terminal. The production default is the
server-owned `ServerTerminalAuthority`, which derives cwd from the server
snapshot instead of keeping a second host copy.

**Streams are positioned, not broadcast.** Each session has a monotonic output
position. Subscribers hold cursors; the server retains a bounded replay
snapshot; duplicate suppression makes a stale cursor safe. When a client asks
to resume from a position that has fallen out of the retained window, the server
raises an explicit retained-replay gap rather than silently delivering a
partial transcript.

**Gaps and write failures fail closed.** A `resync_required` event detaches the
affected attachment instead of leaving a partially replayed terminal
interactive; the terminal-client watermark advances to the server-provided
`replayFrom`, the ambiguous xterm buffer is cleared, and a fresh ordered input
queue is created. Desktop exposes **Retry connection**; the shared web surface
requires reopening the panel. Likewise, a failed write, resize, or
acknowledgement detaches the attachment and the ordered input queue rather than
sending later input with an unknown delivery order.

**One authorized input boundary.** Keyboard, paste, macro, dictation, MCP, and
remote writes all pass through the same server-side boundary with backpressure.
Input, resize, and kill are rejected for exited, stale, cross-project, and
cross-server sessions.

**Viewport leases are released immediately, not by expiry.** Both an
authenticated client disconnect and an ordinary attachment detach release that
client's viewport lease at once, so closing a panel or switching server cannot
leave a dead client blocking the next authorized attachment.
`packages/server-core/test/terminal-protocol.test.mjs` proves both handoffs.

**Presentation stays presentation.** A long tail of terminal interactions were
moved onto the shared path with explicit safety rules rather than being
reimplemented: OSC-8 and detected link activation with duplicate-handler
suppression and a retryable external-open failure; clipboard copy that never
calls the clipboard on an empty selection and survives a denied write; paste
that hands only non-empty text to xterm and refocuses after a denial; portable
path drops on the shared path with raw `File` resolution fenced behind the
Desktop branch; in-buffer search on `Cmd+F`/`Ctrl+F` excluding extended chords;
notes with an unmodified `Escape` route back to the terminal; zoom that keeps a
six-pixel minimum and rejects malformed host values; appearance composition that
never mutates saved settings; `Alt+Tab`/`Alt+Shift+Tab` switching; exit
presentation that suppresses a stale failure line for a configured successful
exit and renders malformed metadata as `unknown` rather than `NaN`;
`Shift+Enter`/`Alt+Enter` bracketed-paste newline input; clear scoped to the
exact live session; split focus restoration bound to a fresh activation
timestamp; and `Shift+PageUp`/`PageDown`/`Home`/`End` scrollback that never
sends input.

## Risks / Trade-offs

- Keeping preload as a compatibility fallback risks two live terminal paths.
  Mitigated by `scripts/terminal-panel-migration.test.mjs`, which keeps the
  preload branch bounded and asserts the server-backed path never calls legacy
  terminal IPC.
- Failing closed on a replay gap makes a congested terminal briefly
  non-interactive. Accepted: a partially replayed terminal that still accepts
  input is worse than an explicit, recoverable error.
- Bounded retained replay means a client offline long enough cannot resume
  exactly; it must resume from `replayFrom`. Accepted as the cost of a bounded
  server memory budget.

## Migration Plan

The Desktop terminal panel gained an opt-in server-backed attachment path
first, preserving the existing xterm surface with preload as a fallback. Once
the Local client used the server transport, the replay/data fallback was
removed, Dockview panel removal fenced `killTerminal` behind the explicit
compatibility branch, and new-terminal and open-at-folder flows were routed
through write-scoped `terminal.create` so the server assigns session identity,
cwd, and dimensions. `DesktopTerminalAuthorityAdapter` remained only for the
non-panel input/resize/kill path and rejects renderer or window ownership
fields.
