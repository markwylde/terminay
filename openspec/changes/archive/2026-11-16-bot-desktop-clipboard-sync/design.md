## Context

The reproduced Mac failure was Control+V: native and renderer key events arrived, but `pasteShortcut` rejects Control+V on macOS, so no host read or RFB clipboard upload occurred. Command+V subsequently worked. The user's context-menu Paste was disabled because the bot had no synchronized clipboard, not because keyboard events or the relay were broken.

`attachDesktopClipboard` currently combines upload with synthesized paste keys. `BotDesktopCanvas` supplies the terminal upload reader from `nativeActions`. Electron supplies the reader through the exact top-level `serverUiHost` binding and preload. The RFB relay already passes bounded ExtendedClipboard messages in control mode; Xvnc receives a Notify and requests text when an X application consumes the clipboard. Continuous sync must announce ownership before the user opens a context menu; it must not wait for a paste key.

Review of the ADR directory identifies ADR-0005 (sandboxed origin-bound host), ADR-0008/0047 (protocol-blind connection host), ADR-0048 (window binding), ADR-0028 (no unapproved polling), ADR-0112 (terminal OSC 52), ADR-0129 (bot clipboard gates), and ADR-0132 (terminal paste bridge). The new clipboard session revisits ADR-0129 decisions 2/3 and ADR-0132; the other boundaries stand. Accepted records remain immutable.

## Goals / Non-Goals

- Text copied on either side becomes available to the other side's native Paste action without a special shortcut. In particular, a copy in another Mac app enables the bot browser's right-click Paste and Ctrl+V.
- Keep one selected desktop as the sharing recipient, even while the user switches to another Mac app. Hiding or retiring that desktop ends sharing.
- Preserve sandboxing, origin/document bindings, Unicode, payload bounds, PRIMARY isolation, and server-side view-only enforcement.
- Files, images, clipboard history, terminal OSC 52 changes, generic browser clipboard grants, and automatic sharing with every bot are outside this change.

## Decisions

### One session in the privileged host

Add an explicitly negotiated text-only host capability with start, stop, update, and change-delivery operations, using the existing closed host bridge conventions. The exact top-level `serverUiHost` binding owns the session; preload exposes only narrow semantic operations. Native clipboard access stays in `electron/`. The host arbitrates one active session across windows, with an opaque generation. The renderer maps the active session to one live control-mode RFB instance. Host code never decodes bot application protocol messages or receives bot credentials.

Selection of a connected, visible control desktop claims sharing. Opening a new control desktop or selecting one in another window replaces the owner. A window losing OS focus alone does not end sharing. Switching away from the desktop view, minimizing/hiding its window, disconnection, view-only, unload, reload, and destruction end sharing. Re-selecting resumes with a fresh session and current host text. Do not automatically reactivate an older desktop after its successor closes.

This crosses the native clipboard-to-sandbox-to-bot boundary deliberately, under the user's requested control-mode sharing behavior. It does not grant ambient `navigator.clipboard.read` permission or a general native API to server UI.

### Observe the host clipboard independently of paste

Read current eligible text once when the session starts. Prefer a native/runtime change subscription that genuinely works while the app is unfocused. The installed Electron 45.3.2 clipboard API and its TypeScript definition offer read/write methods but no main-process change event. Chromium's `clipboardchange` event is scoped to the focused document, with changes while unfocused delivered on return, so it cannot by itself satisfy continuous background sharing.

References inspected on 2026-11-16:

- https://www.electronjs.org/docs/latest/api/clipboard
- https://developer.chrome.com/blog/clipboardchange
- https://www.w3.org/TR/clipboard-apis/
- https://developer.apple.com/documentation/appkit/nspasteboard/changecount

Implementation first verifies whether an available native/runtime event can reasonably satisfy the requirement on the supported Desktop platforms. Do not disguise a library's internal polling as an event source. If no usable event source exists, the proposed fallback is one **500 ms main-process clipboard check**, owned by the single active sharing session. There are no per-window or renderer polls, no overlapping reads, and no check when no sharing session exists. Errors do not create extra retry timers. Disposal cancels scheduling and fences an outstanding read.

**ADR-0028 approval: approved by Mark Wylde on 2026-11-16.** Mark answered Yes to “If no usable background change event exists, approve one 500 ms clipboard check in Electron, only while that desktop owns sharing, stopping when sharing ends?” The pinned API has no documented main-process change event and the Chromium event does not run for unfocused documents, so use this approved monitor. An event source avoids that approval requirement. Until one of these paths is established, do not claim continuous sync is implemented.

### Separate synchronization from paste commands

Split clipboard publication from key synthesis in `desktopClipboard.ts`. Host change notifications call `clipboardPasteFrom(text)` only. Native Linux chords continue through noVNC and consume the already synchronized bot clipboard. Mac Command paste remains a convenience: acquire the latest host snapshot, publish it, then send a complete Linux chord exactly once. Fix Shift construction so Ctrl+Shift+V does not rely on the user still holding Shift after an asynchronous read.

A paste-only design or syncing only when the window regains focus was rejected: it does not meet the clarified continuous-sharing requirement. It can remain an honestly identified browser limitation, not the Desktop implementation.

### Ordering, echoes, and initial state

The host clipboard is authoritative on a new sharing session. Account for Xvnc/noVNC's initial remote clipboard announcement so a late initial snapshot cannot replace the initial host seed. Announce host text to the connected RFB instance and allow Xvnc's normal Notify/Request/Provide exchange to satisfy applications, including TARGETS queries that enable Paste.

Assign monotonic revisions within a session, serialize clipboard operations, and reject completions from retired generations. Compare canonical text (LF line endings for equality) and remember the last applied values in each direction to suppress echoes from our own writes. Do not store a clipboard history or persist revisions/text. A later genuine copy is allowed even if it repeats an earlier value after an intervening change. Concurrency tests must cover both old callbacks after retirement and an old echo arriving after a newer local copy.

### Content and capability handling

Keep text-only limits and bot-to-host control-character filtering. Empty/nontext clipboard contents send nothing and do not reuse a stale snapshot to synthesize a paste. Oversized host text produces the existing size notice. Keep external source content out of logs. View-only and thumbnail paths cannot establish subscriptions.

Advertise the new host capability explicitly. Older Desktop hosts and browser hosts retain the existing native/shortcut paste path, with honest synchronization availability in the desktop UI. Do not silently describe that fallback as synchronized. Browser ambient clipboard permissions remain denied.

## Risks / Trade-offs

- Continuous sharing gives the selected bot text copied in other Mac apps and lets it update the host clipboard while the host window is unfocused → scope it to the explicitly selected, open control desktop and make the sharing state visible.
- Native platform APIs differ and the pinned Electron API has no documented background change event → establish the event source or obtain ADR-0028 approval for the concrete 500 ms fallback before implementing observation.
- Xvnc lazily requests text and may announce initial state → verify the real clipboard TARGETS/data exchange and context-menu Paste, not just a mocked `clipboardPasteFrom` call.
- Asynchronous reads and writes may complete out of order → one revisioned session and a serialized queue with generation checks at every side-effect boundary.
- Several windows/bots could otherwise receive private host text → one host-wide owner; tests cover replacement and stale-owner updates.

## Migration Plan

Ship the negotiated host capability and renderer integration together. No persisted clipboard migration is required. Remove temporary diagnostic instrumentation from this investigation. Existing running bots retain their VNC configuration; no image rebuild should be needed for clipboard observation. Rollback stops the subscription and restores the prior shortcut path; it does not replay clipboard contents.

Verification includes focused Node tests with mandatory timeout/force-exit flags, relevant typechecks/builds, Docker-backed Electron E2E via `npm run test:e2e`, and a real Mac development-app check against Xvnc. Record explicit evidence for right-click Paste, Control+V, copy in both directions, background copies, Unicode, teardown, and no echo loop. Linux or mock checks alone do not close the Mac acceptance item.

## Open Questions

- Resolved 2026-11-16: the exposed APIs provide no usable background event; Mark explicitly approved the described 500 ms, session-owned main-process monitor.
- ADR-0129/0132 are revisited through ADR-0133. Its clipboard-sharing contract follows the user’s clarification; the observation mechanism remains an open implementation prerequisite. Neither prior accepted file is edited.
