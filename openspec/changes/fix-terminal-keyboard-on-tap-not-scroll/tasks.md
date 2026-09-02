## 1. Gesture decision

- [x] 1.1 Extend the pure mobile keyboard interaction module with a single-pointer tap session that arms on down, disarms past a movement threshold, disarms on cancel, and reports whether a release should claim focus; verify it type-checks with no DOM references
- [x] 1.2 Reuse the movement threshold already established for tap-versus-drag in this codebase rather than introducing a second constant; verify by a test asserting the two agree
- [x] 1.3 Verify by unit test that a release with no movement claims focus, a release past the threshold does not, and a cancel does not
- [x] 1.4 Verify by unit test that a second pointer arriving mid-gesture neither claims focus nor disturbs the tracked pointer
- [x] 1.5 Verify by unit test that a slow release with no movement still claims focus, so resting a finger before lifting is not treated as a scroll

## 2. Terminal panel wiring

- [x] 2.1 Register pointer down, move, up, and cancel on the xterm root in place of the current bare pointer-down focus bridge, claiming focus only on a release the session accepts; verify the terminal still focuses on a tap
- [x] 2.2 Gate the legacy touch-start fallback symmetrically with touch move, end, and cancel for hosts without pointer events; verify by unit test over the fallback predicates
- [x] 2.3 Claim focus synchronously inside the releasing event so a platform that gates keyboard presentation on a trusted gesture still presents one; verify no deferral, timer, or microtask sits between the event and the focus call
- [x] 2.4 Verify no `preventDefault` or `stopPropagation` is introduced on any of the new handlers, so xterm keeps ownership of the gesture
- [x] 2.5 Verify the focus announcement fires once per claimed tap and not on scroll gestures

## 3. Existing coverage

- [x] 3.1 Update the mobile keyboard interaction tests that assert focus is claimed on touch-down, so they specify the tap-conditioned contract instead; verify the suite passes
- [x] 3.2 Update the source-shape assertions that pin focus to the pointer-down listener, keeping the prohibition on cancellation and extending it to the new handlers; verify the suite passes
- [x] 3.3 Verify every non-touch focus path is unchanged — tab activation, terminal creation, drops, search close, context menu, and window-activation recovery — by running the existing terminal suites

## 4. Behavioural coverage

- [x] 4.1 Add an end-to-end test in a touch-enabled mobile context that taps the xterm surface and verifies the helper textarea takes focus
- [x] 4.2 Add an end-to-end test that drags across the xterm surface and verifies the helper textarea does not take focus
- [x] 4.3 Verify by test that a drag over the terminal still scrolls the buffer, so the tap gate did not suppress xterm's gesture
- [x] 4.4 Verify by test that scrolling a terminal that already holds focus neither blurs it nor dismisses the accessory row

## 5. Device acceptance

- [ ] 5.1 Confirm on a real iOS device that a tap presents the software keyboard, recording the device and OS version as evidence; this is the one claim no automated harness can prove
- [ ] 5.2 Confirm on the same device that scrolling the terminal presents no keyboard and does not resize the viewport
- [ ] 5.3 Confirm on the same device that the accessory row still appears, sends input, and dismisses the keyboard
