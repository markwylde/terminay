## 1. Touch hold state

- [x] 1.1 Extract the Explorer touch press logic (hold, arm, cancel on move or `pointercancel`, release-after-arm) into a small testable module built on `createLongPressSession` with `FILE_EXPLORER_TOUCH_DRAG_HOLD_MS = 1000`. Verified by unit tests with an injected timer covering: move before 1 s cancels without arming; still for 1 s arms; release before 1 s is a tap; release after arm without moving requests the context menu.

## 2. Explorer wiring

- [x] 2.1 In `FileExplorerTree.tsx`, keep the existing pending-drag path for mouse and pen, and route `pointerType === 'touch'` presses through the hold without `setPointerCapture`. Verified by the existing Explorer drag E2E still passing for mouse.
- [x] 2.2 On arm, add `file-explorer-tree-item--drag-armed`, record the pending drag from the touch start so the existing 6 px threshold decides drag versus release-in-place, and attach a non-passive `touchmove` listener that calls `preventDefault()` only while armed. Verified by the E2E in 3.1.
- [x] 2.3 Suppress the entry `contextmenu` event while a touch press is pending or armed; on release of an armed touch without movement, open the Explorer context menu at the release point and swallow the following click. Verified by the E2E in 3.1.
- [x] 2.4 Add the armed style to `src/App.css`. Verified visually in the compact layout.

## 3. Verification

- [x] 3.1 Add an Electron E2E spec using CDP touch input on a long Explorer tree: touch-and-move within 1 s scrolls the tree and starts no drag; hold 1 s then move drags the entry and dropping on the tab area opens it; hold 1 s then release opens the context menu; a quick tap activates the entry. Verified by `npm run test:e2e` for that spec passing.
- [x] 3.2 Run `npm run lint`, `npm run typecheck:workspaces`, the unit tests, and `openspec validate --all`. Verified by each command exiting 0.
