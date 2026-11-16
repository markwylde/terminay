## Context

The device-to-bot side of the bot desktop clipboard comes from the archived change `2026-11-16-bot-desktop-clipboard` and ADR-0129. It reads host text only from the native `paste` event that the user's shortcut raises. A capture listener on the desktop layer kept the shortcut from noVNC without cancelling it. A `paste` listener on the same layer handled the event.

In the deployed macOS app, copying from the bot worked and pasting into it did not. A Chromium reproduction showed why. With a text selection left elsewhere on the page, Ctrl+V on the focused canvas raised `paste` at that selection's node, outside the layer, so the layer never heard it. noVNC calls `preventDefault` on `mousedown`, so clicking into the desktop never clears that selection. Another noVNC integration reports a related problem: Chromium does not reliably dispatch `paste` to a target that is not editable, and on macOS, Edit › Paste needs editable focus.

## Goals / Non-Goals

**Goals:** A paste shortcut on the focused desktop always pastes into the bot, on every platform, whatever is selected elsewhere. The desktop keeps focus afterwards.

**Non-Goals:** This change does not alter what is read (still only the native paste event, ADR-0005), the limits, or the bot-to-device direction.

## Decisions

- **A hidden textarea inside the layer is the paste target.** When the keydown capture listener sees the shortcut, it focuses the textarea without cancelling the key. Chromium runs the paste command against the focused editable element, so the event targets the textarea, and macOS enables Edit › Paste. *Alternative rejected:* clearing the document selection. That covers the stale selection but not the macOS need for editable focus.
- **`paste` is heard on the document, but gated.** The listener sits on the document in the capture phase. It handles the event only in two cases: the desktop has just seen the shortcut, or the desktop holds focus (Edit › Paste chosen from the menu). It cancels the event, so the textarea never receives the text. A paste anywhere else is left untouched.
- **Focus returns at once.** The paste handler empties the textarea and refocuses noVNC's canvas. If no paste arrives, a one-second timer does the same. This covers, for example, a clipboard that holds no text, where the menu item is disabled.
- **Modifier tracking follows focus.** When focus moves out to the textarea, `focusout` does not clear held modifiers. A modifier keyup that arrives while the textarea is focused never reaches noVNC's canvas listener, so the viewer releases that key in the bot itself.
- **No new programmatic clipboard read.** `navigator.clipboard.readText()` or a read through the Desktop bridge would also work. Either would add an ambient read path, which ADR-0005 rules out. The native event is enough once it has a target.

## Risks / Trade-offs

- [The textarea holds focus briefly] → It is invisible, takes no pointer events, cannot be reached with Tab, and is hidden from assistive technology. It holds focus for at most one paste or one second.
- [Chromium may change how it targets paste] → A recorded check against the Chromium in the e2e base image covers this behaviour (`evidence/chromium-stale-selection-paste-check.mjs`).
