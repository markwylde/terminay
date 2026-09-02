## 1. Narrow presentation

- [x] 1.1 Remove the narrow-layout height cap on the navigation aside so it is no longer limited to a fixed fraction of the viewport; verify by a computed-style test below the breakpoint that the aside height is not 24rem
- [x] 1.2 Present narrow navigation as an overlay over the workspace content at the full height available to the workspace, with a scrim between them; verify by a computed-style test that the aside and the content occupy the same vertical extent
- [x] 1.3 Give the content track the full viewport whether navigation is open or closed; verify by test that the content's measured height is identical in both states
- [x] 1.4 Remove the outer overflow container from the narrow aside so the stack, not the sidebar, owns scrolling; verify by test that the sidebar element never scrolls vertically below the breakpoint
- [x] 1.5 Verify by test that the wide layout keeps its two-column grid, its separator, and its persisted navigation width, with no computed-style change

## 2. Dismissal and focus

- [x] 2.1 Close the drawer from the navigation control, the Escape key, and activation of the scrim; verify each route by test
- [x] 2.2 Move focus into the drawer when it opens and return it to the control that opened it when it closes; verify by test asserting the focused element before, during, and after
- [x] 2.3 Confine keyboard focus to the drawer while it is open; verify by test that cycling focus never reaches the content behind it
- [x] 2.4 Mark the workspace content unavailable to assistive technology while the drawer is open, and restore it on close; verify by test inspecting the accessibility state in both conditions
- [x] 2.5 Verify by test that closing the drawer does not resize the content's panels to a different geometry than before it opened

## 3. Breakpoint authority

- [x] 3.1 Drive the component's drawer behaviour from a single observation of the existing narrow breakpoint rather than a new independent width check; verify by test that presentation and behaviour switch at the same width
- [x] 3.2 Verify by test that crossing the breakpoint in both directions leaves navigation visibility and width persistence intact and produces the layout the same normalization rules would

## 4. Coverage that does not exist today

- [x] 4.1 Add a computed-style test that renders the split layout below the narrow breakpoint, since no test does so today; verify it fails against the pre-change stylesheet
- [x] 4.2 Add an end-to-end test in a narrow mobile viewport that opens navigation and asserts the sidebar fills the viewport height
- [x] 4.3 Add an end-to-end test that dismisses the drawer and asserts the terminal occupies the full viewport
- [x] 4.4 Verify on a short narrow viewport that a host below the title budget still shows the non-scrolling minimum-height status rather than a clipped stack
- [x] 4.5 Verify by test that a pane body with overflowing content scrolls inside the drawer while neither the drawer nor the sidebar scrolls

## 5. Acceptance

- [x] 5.1 Confirm in a real browser at a phone-sized viewport that the file tree and Git panes fill the screen when navigation is open, recording the viewport and result as evidence
- [x] 5.2 Confirm on the same viewport that dismissing navigation restores a full-height terminal and that all three dismissal routes work by touch
- [x] 5.3 Confirm the Desktop workspace at normal window sizes is visually and behaviourally unchanged
