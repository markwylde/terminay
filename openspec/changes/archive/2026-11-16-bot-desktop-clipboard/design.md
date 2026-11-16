## Context

A bot's desktop is Xvnc on `:1`, running inside the bot's container. It is TigerVNC 1.15 from Debian trixie, listening on loopback with VncAuth and started with `-ac`. The server reaches it through `terminay-init --tunnel 5901` over an engine exec. It authenticates, then relays RFB to the client over the Terminay connection as security None (`packages/server-core/src/botService/rfb.ts`). The server filters client messages through `BotRfbClientFilter`. It passes server-to-client bytes through unparsed. The renderer draws the desktop with noVNC 1.7.0 (`src/workspace/bots/BotDesktopView.tsx`) over `RfbStreamChannel`.

Today:

- **Xvnc already owns the clipboard.** Xvnc 1.15 owns CLIPBOARD and PRIMARY itself, so no `vncconfig` helper is needed. `SendCutText`, `AcceptCutText`, `SendPrimary` and `SetPrimary` are all on by default, and `MaxCutText` defaults to 256 KiB. `vncconfig -display :1 -set SendPrimary=0` changes a running server; this was verified against 1.15. `MaxCutText` cannot be changed at runtime.
- **noVNC decodes but the viewer ignores it.** noVNC dispatches a `clipboard` event for server cut text, and ignores that text when `viewOnly` is set. `rfb.clipboardPasteFrom(text)` sends text to the server. In the extended form it first sends Notify, then answers the server's Request with Provide. It converts line endings to CRLF and appends a NUL. The viewer uses neither the event nor the method.
- **The relay forces Latin-1.** `allowedEncodings` drops pseudo-encoding `0xC0A1E5CE` (ExtendedClipboard), so the exchange is legacy Latin-1. `BotRfbClientFilter` reads the `ClientCutText` length as unsigned, so an extended message, which has a negative length, would be rejected as oversized.
- **View-only already discards clipboard.** In view-only mode the filter forwards only `SetPixelFormat`, `SetEncodings` and `FramebufferUpdateRequest`, so client clipboard messages never reach the bot.
- **Host clipboard routes.** These are set by ADR-0005 and ADR-0112. Writes go through `writeClipboardText` (`src/host/nativeActions.ts`), which uses the Desktop bridge's `clipboard.write` or the browser Clipboard API. The Desktop server-UI session denies ambient `clipboard-read`. A native, user-initiated paste is the sanctioned read.
- **Client and server can differ in version.** A Desktop window may run its own packaged bundle against a remote server of another version (ADR-0047).

## Goals / Non-Goals

**Goals:**

- Share clipboard text both ways between the bot desktop and the device showing it, in control mode, with Unicode intact.
- Read host text only through the user's paste shortcut. Write to the host only while the user is actively controlling the desktop.
- Behave the same in Terminay Desktop, a desktop's own window, and a paired browser client, with no new host capability.

**Non-Goals:**

- Images, files, rich text or HTML on the clipboard.
- Syncing on focus or in the background, or any programmatic clipboard read.
- Clipboard sharing in view-only mode or on the thumbnail.
- Proving that a bot clipboard change came from a user's copy. While the user controls the focused desktop, any change to the bot's clipboard counts, including one made by a bot process. This is accepted as the trust the user gives a desktop they are actively driving, and it matches ADR-0112's terminal stance.
- A per-device switch. Control mode is the opt-in.

## Decisions

### 1. Host → bot only through the native paste event of the user's paste shortcut

The viewer adds capture-phase `keydown` and `keyup` listeners on its layer element, which is an ancestor of noVNC's canvas. They do two jobs:

- **Track modifiers.** The listeners record which host modifier keys are physically held, by `code`: `ControlLeft/Right`, `ShiftLeft/Right`, `MetaLeft/Right`. They never stop these events.
- **Divert the paste shortcut.** In control mode the listener recognises the platform paste shortcut: Cmd+V or Cmd+Shift+V on macOS, Ctrl+V, Ctrl+Shift+V or Shift+Insert elsewhere. It calls `stopPropagation()` without `preventDefault()`, so noVNC never sees the key and never cancels it. The browser, or Electron's Edit › Paste, then raises a native `paste` event on the canvas. The matching `keyup` is stopped as well.

The `paste` handler reads `clipboardData.getData('text/plain')`. It checks the limit (decision 4), calls `rfb.clipboardPasteFrom(text)`, and then presses the chord with `rfb.sendKey`. A pure helper builds the chord's key sequence:

1. Release the keysyms noVNC holds in the bot for the tracked host modifiers that are not part of the Linux chord. On macOS, noVNC maps `MetaLeft` to `Alt_L` and `MetaRight` to `Super_L`. Elsewhere it maps `ControlLeft` to `Control_L` and `ControlRight` to `Control_R`.
2. Press `Control_L`, unless the chord is Shift+Insert. Press and release `V` or `Insert`. Then release `Control_L`. Shift is never pressed or released here: a chord with Shift comes from the user holding Shift, which noVNC has already pressed in the bot.
3. Press again the keysyms released in step 1, so noVNC's view of the held keys stays true. noVNC releases them itself when the user lets go.

The chord never depends on noVNC's held-modifier state. This avoids two problems. One is macOS's Cmd→Alt/Super mapping. The other is noVNC's Windows AltGr detection, which can hold back a left Ctrl press for up to 100 ms. If the user pastes again before releasing the modifier, the whole sequence repeats.

Ordering holds because RFB is a single ordered stream. In legacy mode the cut text arrives before the keys. In extended mode, Notify arrives before the keys, and Xvnc answers the X application's selection request once Provide arrives.

**Boundary:** renderer ↔ host clipboard (ADR-0005). The read happens only inside a user-initiated native paste. No bridge action, IPC or permission is added.

**Alternatives:**

- **Sync on focus or pointerdown.** This needs a programmatic read, which Desktop denies and browsers prompt for. It would also leak whatever the user copied last.
- **A "Paste to bot" button.** This takes two steps, and the text does not land in the focused application.
- **Reuse `readTerminalClipboard`.** This would extend a terminal-specific privileged read, which shell-quotes file paths, to a new surface.

### 2. Bot → host only while the user is actively controlling the desktop

The viewer listens for noVNC's `clipboard` event. It writes only when all of these hold:

- the stream is in control mode;
- `document.activeElement` is inside that layer;
- `document.hasFocus()`;
- `document.visibilityState === 'visible'`.

If all hold, it passes the text through `clipboardTextForHost`. That function returns `undefined` for empty text, for text over 1 MiB of UTF-8, and for text containing a control character other than tab, LF or CR. This follows ADR-0112: rejected, not stripped. Otherwise the viewer calls `writeClipboardText`. A dropped change is never replayed. A refused host write is ignored silently.

**Boundary:** bot container → user's device. The gate keeps a bot from replacing the clipboard while the user works in another application, another tab, or another part of Terminay with the desktop left open in control mode.

**Alternatives:**

- **Write whenever control mode is open.** This lets a bot overwrite the clipboard silently.
- **Confirm each copy.** A prompt on every copy makes copying unusable.

### 3. Admit ExtendedClipboard through the relay

The relay adds `0xC0A1E5CE` (signed -1063131698) to `relayedEncodings`. `BotRfbClientFilter` reads the `ClientCutText` length as signed:

- A non-negative length keeps today's Latin-1 path, with a payload of at most 1 MiB.
- A negative length is an extended message. Its magnitude must be between 4 (the flags word) and `BOT_DESKTOP_CLIPBOARD_BYTES` (1 MiB), or the stream closes.

The relay forwards the extended message unchanged in control mode and discards it in view-only mode, exactly like the legacy form.

The relay still advertises no extension whose required client replies it blocks:

- **Control mode.** Every extended-clipboard reply is a `ClientCutText`, which the relay forwards.
- **View-only mode.** noVNC's capability reply is discarded, so Xvnc keeps the client as one without extended capabilities. noVNC ignores server clipboard traffic when `viewOnly` is set.

The server-to-client direction is unchanged and still not parsed.

**Boundary:** client → server desktop allowlist. The bound and the view-only discard stay the same. Only the encoding of an already allowed message widens.

**Version skew:**

- A current viewer against an older server gets no extended capabilities from Xvnc, because the older relay strips the encoding. noVNC then falls back to Latin-1 by itself, so clipboard sharing works but characters outside Latin-1 become `?`.
- An older viewer against a current server shares nothing, which is today's behaviour.

### 4. Limits on both sides

| Direction | Where | Bound |
|---|---|---|
| Device → bot | viewer, before sending | UTF-8 of the text with line endings as CRLF, plus the NUL noVNC appends: at most 1 MiB. Otherwise nothing is sent and the bar says "Too large to paste into the bot." |
| Device → bot | relay | Each `ClientCutText` payload, legacy or extended, is at most 1 MiB. |
| Device → bot | Xvnc | New containers start with `-MaxCutText=1048576`, which matches the viewer bound. Containers created earlier keep 256 KiB until recreated, and Xvnc silently ignores larger pastes there. |
| Bot → device | viewer, before writing | At most 1 MiB of UTF-8, which is the host bridge bound. |

The server-to-client cut text, and its inflated size inside noVNC, stay unbounded before the event fires. This is the same trust the desktop stream already gives the bot's framebuffer data in the renderer. The viewer bound limits what reaches the host clipboard, not renderer memory.

### 5. Selection isolation for every container

`terminay-init` starts Xvnc with `-SendPrimary=0 -MaxCutText=1048576`. `AcceptCutText` and `SendCutText` stay on. `SetPrimary` stays on, so pasted host text also works with middle-click in the bot.

Before `BotDesktopService.open` starts the tunnel for a control-mode stream, it runs `vncconfig -display :1 -set SendPrimary=0` as root in the container, then `vncconfig -display :1 -get SendPrimary`. If the second command does not print `off`, the open fails, and the user can still view in view-only mode. This covers containers created before this change, whose Xvnc started with PRIMARY sending on. `tigervnc-tools` (`vncconfig`) is already in the image. The commands are fixed argv with no user input, and they run under the same engine authority the tunnel uses.

**Boundary:** server → bot container exec. It adds nothing beyond the existing root exec into the bot's own container.

## Risks / Trade-offs

- **Clipboard writes can be refused without focus or activation, for example on iOS Safari.** → Copying is best effort. The scenario is phrased as a write request.
- **A bot process can replace the clipboard while the user drives the focused desktop.** → This is accepted and documented as a non-goal. The window must be focused and visible as well.
- **The macOS chord briefly releases and re-presses Alt_L or Super_L in the bot.** → The bot sees only a modifier release and press around the chord, and noVNC's own release later is consistent.
- **The `vncconfig` exec adds latency to opening control mode, and a new failure path.** → It is two short execs. If it fails, the stream does not open and view-only still works. The failure is surfaced as "desktop connection failed".
- **Containers created before this change keep the 256 KiB `MaxCutText` until recreated.** → A larger paste is ignored there. The image fingerprint covers these sources, so the container is recreated when it next starts.
- **noVNC behaviour is used outside its typed surface: the `clipboard` event, `sendKey`, and keyboard mapping.** → noVNC is pinned at 1.7.0. `novnc.d.ts` declares exactly what is used, and the chord helper's tests encode the mapping.

## Migration Plan

There is no data migration. Rollback is a revert. Running containers get PRIMARY isolation at their next control-mode open, and the new Xvnc flags when they are recreated.

## Open Questions

None.
