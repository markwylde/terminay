# ADR-0129: A bot desktop shares the clipboard only while the user controls it

Status: accepted
Date: 2026-11-16

## Context

Users controlling a bot's desktop need to copy text out of it and paste text into it (issue #543). The desktop is an RFB stream. It comes from Xvnc in the bot's container, the server relays it, and noVNC in the workspace UI draws it. Both directions cross a trust boundary:

- **Host to bot.** The user's clipboard can hold anything, including passwords. The workspace UI runs in a sandboxed host that denies ambient clipboard reads (ADR-0005). The only sanctioned read is a native, user-initiated paste.
- **Bot to host.** The bot is an autonomous agent. If it could replace the user's clipboard at any moment, a user who later pastes into their own terminal would run text the bot chose.

## Decision

1. **Control mode only.** Clipboard sharing exists only on a control-mode desktop stream. View-only streams and the thumbnail never read or write either clipboard. The server keeps discarding client clipboard messages on them.
2. **Host to bot happens only inside a native paste.** When the user presses the platform paste shortcut on the focused desktop, the client lets the browser raise its native `paste` event, and keeps noVNC from consuming the key. The client sends that event's text to the bot's clipboard. It then presses the Linux paste chord in the bot, building it explicitly rather than relying on the modifiers noVNC holds there. The client never reads the device clipboard programmatically. No host bridge action, IPC or permission is added for this.
3. **Bot to host happens only while the user controls the desktop.** Every one of these must hold: the desktop has keyboard focus, the document has focus, and the document is visible. When they do, a bot clipboard change is written through the host's existing semantic clipboard-write route, the same route ADR-0112 uses. Text that is empty, longer than 1 MiB, or contains a control character other than tab, LF or CR is rejected. A change made while the gate is closed is dropped and never replayed. Any process in the bot may cause such a change; the gate, not provenance, is the control.
4. **Highlighting is not a copy.** The bot's Xvnc never sends its PRIMARY selection. New containers start that way. The server also turns PRIMARY sending off on the running Xvnc before it relays any control-mode stream, and refuses the stream if it cannot confirm the setting is off.
5. **The allowlist admits UTF-8 clipboard text.** The relay's desktop allowlist admits `ClientCutText` in both its Latin-1 and its extended (UTF-8) form, each with a payload of at most 1 MiB. The relay advertises the ExtendedClipboard pseudo-encoding. Text the client sends is bounded at 1 MiB once line endings are counted as CRLF.

## Rejected alternatives

- **Sync the host clipboard to the bot on focus.** This needs a programmatic read, which Desktop denies and browsers gate behind a prompt. It would also hand the bot whatever the user last copied.
- **Add a privileged Desktop read for the bot desktop.** This adds a host capability, and browsers would still lack it.
- **Write bot clipboard changes whenever control mode is open.** A bot could then replace the clipboard silently while the user works elsewhere.
- **Gate bot-to-host writes on a detected user copy chord.** Copy chords vary by application, and a chord does not prove where the text came from either. The focus gate is simpler and states its trust honestly.

## Consequences

- **Familiar shortcuts work everywhere.** Copy and paste use the shortcuts users already know, in Desktop, in a desktop's own window and in browser clients.
- **The bot sees only what the user pastes.** Text reaches the bot only when the user explicitly pastes it.
- **The bot can change the clipboard only during focused control.** It can do so only while the user is driving its focused, visible desktop in control mode.
- **Host paste needs the keyboard shortcut.** A context-menu paste inside the bot pastes the bot's own clipboard.
- **Opening control mode costs two short execs into the container.** If they fail, control mode fails to open.
- **Some browsers may refuse the clipboard write.** On iOS Safari, for example, the refusal is silent, as it is for ADR-0112.
