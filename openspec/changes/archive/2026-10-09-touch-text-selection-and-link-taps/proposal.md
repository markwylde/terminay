## Why

Touch over the terminal reached a good place and should stay there: a drag
reaches xterm untranslated and becomes wheel mouse reports, a viewport scroll,
or cursor keys depending on what the foreground program asked for. Getting
there cost the two things a mouse gets for free, because xterm's gesture
manager calls `preventDefault` on the touchstart it consumes and the browser
therefore synthesises none of the compatibility mouse events the rest of xterm
listens for:

- There is no way to select text. The panning gesture owns every drag.
- A link cannot be opened at all. The tap produces no `mousemove` for xterm's
  linkifier to resolve a link from and no `mouseup` for it to activate one on,
  and terminal link activation additionally requires a modifier key that a
  touch device has no way to hold. Two further browser-only faults sit behind
  that: `openExternalUrl` and `writeClipboardText` both await an absent Desktop
  bridge before reaching the browser API, and Safari refuses a window open or a
  clipboard write issued after that await because the user activation is spent.

## What Changes

- A stationary touch held for one second over the terminal enters text
  selection mode for that gesture: the word under the finger is selected, the
  drag that follows extends the selection, and xterm's panning is suppressed
  for the remainder of that gesture only. A touch that travels before the hold
  elapses is a pan and is left entirely alone.
- Holding is governed by **Edit > Enable Text Selection**, on by default and
  remembered per device. Off restores today's behaviour exactly.
- A finished touch selection offers a Copy affordance, since a touch device has
  no right click to reach the existing context menu with.
- A tap on a link opens it, without the modifier key a touch device cannot
  hold, whatever the foreground program is doing — an interactive program with
  mouse tracking on is where the links worth tapping usually are.
- Browser clients open external links and write the clipboard inside the user
  activation that asked for it, rather than after awaiting a Desktop bridge
  that is not there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: the touch input requirement gains hold-to-select and
  its per-device toggle, and the link safety requirement gains touch
  activation and the user-activation constraint on browser clients.

## Impact

- `src/components/terminalTouchSelectionInteraction.ts` — new: the hold state
  machine, the xterm selection driver, and touch link activation.
- `src/shared/touchTextSelectionPreference.ts` — new: the per-device toggle.
- `src/components/TerminalPanel.tsx` — gesture wiring and the copy affordance.
- `src/components/terminalLinkInteraction.ts` — modifier-free touch activation.
- `src/host/nativeActions.ts` — browser clients act inside the activation.
- `src/web/ConnectedWebRendererWorkspace.tsx` — the Edit menu toggle, and
  checkable items in the browser menu bar.
- Tests: `scripts/terminal-touch-selection-and-links.test.mjs`.
