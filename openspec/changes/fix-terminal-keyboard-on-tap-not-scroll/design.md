## Context

See proposal.md — Why for motivation, and `specs/terminal-workspace/spec.md` for the behaviour contract.

The relevant existing shape:

- The terminal panel constructs xterm and mounts it on a root element. On that root it registers a `pointerdown` listener, plus a legacy `touchstart` listener used only where `PointerEvent` is unavailable. Either one focuses the terminal immediately, with no movement or duration test.
- That bridge exists deliberately. xterm's own gesture recogniser binds `touchstart` and `touchmove` non-passively and calls `preventDefault()` once it dispatches a gesture, which suppresses the compatibility `mousedown` that would otherwise focus the helper textarea. Without the bridge, tapping a terminal on a touch device would not focus it at all.
- Scrolling is entirely xterm's: its recogniser is attached to the screen element and translates a touch pan into buffer scrolling, or into arrow keys for alternate-screen applications. Terminay adds no touch handling over the surface and calls `preventDefault` nowhere on it — a constraint an existing source-shape test enforces.
- Two gesture idioms already exist in the codebase, both pointer-based with a distance threshold measured by `Math.hypot`: the long-press session used by the project switcher and dock tabs, and the file-explorer drag. The long-press helper is a pure session object with an injectable timer and a thin React wrapper.
- The decision logic for the current bridge already lives in a pure module beside the panel, paired with a plain node test. That separation is the pattern to extend.

Two constraints follow and drive everything below. Focus must still be claimed inside a trusted user gesture, because that is what makes a platform present its software keyboard. And the bridge must continue to leave xterm's gesture untouched, because scrolling belongs to xterm and cancelling its events would break it.

## Goals / Non-Goals

**Goals:**
- Discriminate tap from scroll before claiming focus, using the movement threshold idiom already established in this codebase.
- Keep the focus call inside the releasing touch event so software-keyboard presentation still works.
- Keep the decision pure and unit-testable, separate from the panel's effect wiring.
- Add real coverage for the drag case, which has none today.

**Non-Goals:**
- Changing what happens once the keyboard is visible: the accessory row, the dismissal control, and the visual-viewport geometry handling are untouched.
- Introducing a long-press, double-tap, or multi-touch affordance on the terminal surface.
- Unifying the panel's local keyboard-visibility heuristic with the shared responsive viewport model. That duplication is real but is a separate concern from this defect.
- Any change to how xterm scrolls, or to scrollback behaviour on any input device.

## Decisions

### The bridge becomes a gesture session, armed on down and resolved on up

A pure session object tracks one pointer: its id, its starting coordinates, and its start time. `pointerdown` arms it, `pointermove` disarms it once travel exceeds the threshold, `pointerup` claims focus only if it is still armed, and `pointercancel` disarms it. The panel registers all four on the xterm root instead of the single `pointerdown` it registers today, and the legacy `touchstart` path is gated symmetrically by `touchmove` and `touchend`.

This mirrors the long-press session rather than inventing a second gesture vocabulary: same pure-object shape, same injectable timing, same `Math.hypot` distance test.

**Alternative considered — keep focusing on `pointerdown` and blur again on move.** Rejected: on iOS the keyboard has already begun animating in by the time the move is observed, so the user still sees it flash, and the viewport still resizes. It treats the symptom.

**Alternative considered — let xterm's own gesture recogniser report tap versus pan.** Rejected: it exposes no such signal, and depending on its internals would couple Terminay to a beta dependency's private behaviour.

### The movement threshold matches the existing idiom

The threshold is a small pixel distance in the range the codebase already uses for this decision elsewhere. It is deliberately not a new tunable: a terminal tap and a terminal scroll are the same gesture family as a tab tap and a tab drag, and a second constant with a different value would be a bug waiting to happen.

A time budget is available in the session but is not used to reject a slow tap. A user resting a finger before releasing without moving is tapping, and refusing them a keyboard would be a worse defect than the one being fixed.

### Focus is still never cancelling

The session observes pointer events; it does not consume them. No `preventDefault` and no `stopPropagation` are added over the xterm surface, so the gesture recogniser sees exactly what it sees today and scrolling is unaffected whether the terminal ends up focused or not. The existing source-shape assertion that forbids cancellation is kept, and extended to the new handlers.

## Risks / Trade-offs

- **`pointerup` may not count as an activating gesture for software-keyboard presentation on some platform** → this is the change's central risk and cannot be settled by any automated harness. It is discharged by an explicit manual check on a real iOS device before the change is archived, recorded as evidence. If a platform refuses, the fallback is to claim focus on the first `pointermove`-free frame after `pointerdown` and blur on movement, accepting a brief keyboard flash on that platform only.
- **A tap that lands during momentum scrolling could focus unexpectedly** → the session only arms on a fresh `pointerdown`, and a tap to arrest momentum is a genuine tap; treating it as focus is consistent with how the rest of the workspace behaves.
- **Two tests pin the current shape and will fail loudly** → intended. They are the specification of the old behaviour and must be rewritten as part of the change, not deleted.
- **Multi-touch** → the session tracks a single pointer id and ignores others, so a second finger arriving mid-gesture neither claims focus nor disturbs the tracked pointer.

## Migration Plan

None. The change is confined to client-side event wiring in the shared workspace UI; there is no persisted state, no protocol surface, and nothing to roll forward or back. Reverting is a straight revert of the commit.
