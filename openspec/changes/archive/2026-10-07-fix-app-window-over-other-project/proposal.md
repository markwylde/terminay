## Why

An app window that a terminal in one project opens is drawn on top of whichever
project the user is looking at. Asking an agent in project A for a window and
then moving to project B puts A's window over B's workspace, at the position of
A's terminal pane, where it covers B's sidebar or terminals and appears to
belong to B. Project A's tab does not pulse either, so nothing says where the
window really is.

The window record itself is correct: it carries its terminal and project, and
the project tab's count is right. The defect is in presentation. All windows are
laid out by one host above every project, which hides a window when its
terminal's pane is not on screen and judges that by the pane having a size. An
inactive terminal tab has no size; an inactive project keeps its full size and
is only made invisible, so its panes pass the check.

## What Changes

- A window is shown only while the terminal that owns it is the one the user is
  looking at. A terminal in a project that is not in front is not being looked
  at, whatever its layout size.
- A window that arrives for a terminal in a project that is not in front pulses
  that terminal's badge and its project's badge, as it already does for an
  inactive terminal tab.
- The view of a window in a project that is not in front keeps running and
  keeps its state, as it does today for an inactive terminal tab.
- An end-to-end test covers a window arriving while another project is in front.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `terminal-app-windows`: adds the requirement that a window is presented only
  over its own terminal while that terminal is shown, including across projects.
  The capability is introduced by the `terminal-app-windows` change, which is
  implemented and not yet archived; this change adds one requirement beside it
  and edits none of its requirements.

## Impact

- `src/workspace/appWindows/appWindowPanes.ts`: what counts as a pane being on
  screen.
- `src/workspace/appWindows/AppWindowHost.tsx`: consumes that answer for hiding
  windows and for marking a window unseen; no change of structure expected.
- `e2e/app-windows.spec.ts`: one new test.
- No protocol, server, MCP, or storage change. No new dependency.
