## 1. Reproduce the failure

- [x] 1.1 Add an end-to-end fixture that mounts `WorkspaceSplitLayout` with a controlled width owner and a committed-width seam. Verified by a plain pointer drag that presses, moves, and releases, and asserts the released width both renders and reaches the owner.
- [x] 1.2 Add the regression case that releases pointer capture mid-gesture while the pointer is held. Verified by the test failing against the current component with zero committed widths and the sidebar back at its pre-drag width.

## 2. Keep a capture-less gesture alive

- [x] 2.1 Stop the sidebar width separator cancelling on `lostpointercapture`, so the drag session survives and the window `pointerup` commits it. Verified by task 1.2's test passing.
- [x] 2.2 Confirm `pointercancel`, window blur, and unmount still cancel a width drag and restore the pre-drag width. Verified by tests covering each abort signal, asserting the pre-drag width and no committed width.
- [x] 2.3 Confirm a completed width drag still produces exactly one project-scoped sidebar update. Verified by the existing `sidebar resize cancellation and width previews do not flood workspace commands` end-to-end test.

## 3. Verify the whole surface

- [x] 3.1 Run the sidebar end-to-end suites through `npm run test:e2e`. Verified by a green run covering `e2e/project-sidebar-layout.spec.ts` and the new width specs.
- [x] 3.2 Run `npx biome lint` over the changed files and `openspec validate --all`. Verified by both reporting no findings.
