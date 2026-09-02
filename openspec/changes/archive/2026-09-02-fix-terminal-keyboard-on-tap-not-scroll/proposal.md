## Why

On a touch device, scrolling the terminal raises the software keyboard. Terminay focuses xterm's helper textarea on touch-*down*, before it can know whether the gesture is a tap or a scroll, so every attempt to read back through scrollback is interrupted by a keyboard covering half the screen and by the viewport resizing underneath the content the user was trying to read.

## What Changes

- **A tap raises the keyboard; a scroll does not.** Terminal focus moves from touch-down to touch-up, and is claimed only when the gesture stayed within a small movement threshold — the same tap-versus-drag discrimination the file explorer and long-press menus already use.
- **A cancelled or moved gesture claims nothing.** Movement past the threshold, or a cancelled pointer, disarms the pending focus; the terminal is left exactly as it was.
- **Scrolling is untouched.** xterm continues to own touch panning and scrollback. Terminay still adds no `preventDefault` or `stopPropagation` over the xterm surface, so the gesture recogniser keeps working whether or not the terminal is focused.
- **A terminal that is already focused stays focused** while the user scrolls it. Scrolling neither blurs the terminal nor dismisses a keyboard that is already up.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminal-workspace`: the touch focus bridge becomes tap-conditioned rather than firing on any touch, and a scroll gesture is specified as raising no keyboard.

## Impact

- **Affected code:** the touch focus bridge in the terminal panel, and the pure mobile-keyboard interaction module that decides whether a pointer should claim focus. The gesture-session shape already used for long-press and file-explorer drags is the established idiom to follow.
- **Affected tests:** two suites pin the current touch-down behaviour and must change with it — the mobile keyboard interaction unit tests, and the source-shape assertions that require focus to be bound to `pointerdown`. There is currently no test that drags across the xterm surface, so coverage must be added rather than adjusted.
- **Platform risk:** iOS Safari only presents the software keyboard when `focus()` runs inside a trusted user gesture. Moving focus from touch-down to touch-up is the whole point of this change and is also its only real hazard; it needs confirming on a real device, because no automated harness can prove it.
- **Explicitly unaffected:** the accessory row and its input boundary, keyboard dismissal, the visual-viewport geometry handling, and every non-touch focus path (tab activation, terminal creation, drops, search, window activation).
- **Non-goals:** changing scrollback behaviour, adding gesture translation, introducing a long-press or multi-touch affordance on the terminal, or unifying the panel's keyboard-visibility heuristic with the shared responsive viewport model.
