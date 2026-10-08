## Why

In a browser, Terminay's secondary surfaces are a set of unrelated boxes pinned
to the middle of the page. Settings and Remote Control have a heading and a
"Close" text button; About has a floating × over its artwork; Edit Tab and Edit
Project have no title bar or close control at all; the smaller dialogs (MCP
install, pairing, worktree sign-in, update) each draw their own frame. None of
them can be moved off the thing they cover, and none can be resized, so Settings is stuck at one size however large or small the browser
is. Desktop does not have this problem for its management surfaces because the
operating system supplies the window; the in-page presentation has nothing
doing that job.

## What Changes

- One window frame for every in-page window and dialog: a title bar carrying
  the title and a close button, the same border, radius, shadow, and backdrop
  everywhere. The ad-hoc "Close" text button, the About ×, and each dialog's
  private frame go away.
- Windows are moved by dragging the title bar and can never be dragged out of
  reach.
- Settings, Macros, Recordings, and Remote Control are resized from any edge or
  corner and have a maximise button; double-clicking the title bar maximises
  and restores.
- About, Edit Tab, Edit Project, and the small dialogs take the size of their
  content. They get the frame and can be moved, but are not resized or
  maximised.
- Windows stay modal: one dimmed backdrop, focus held inside the window, Escape
  and a press on the backdrop close it, and focus returns to where it was. A
  dialog opened from inside a window stacks above it.
- A resizable window's size, position, and maximised state are remembered per
  browser and restored on the next open, corrected to fit the current viewport.
- Windows follow the viewport: they are pulled back inside when the browser
  shrinks, and at the compact breakpoint every window fills the viewport with
  no move, resize, or maximise affordances.
- Not included: non-modal windows, several windows side by side, and
  minimising. Confirmation prompts, the Command Bar, and the compact switcher
  keep their own presentation.

## Capabilities

### New Capabilities

- `in-page-windows`: the frame, movement, resizing, maximising, modality,
  remembered geometry, and viewport behaviour of windows and dialogs that
  Terminay presents inside the page rather than as native windows.

### Modified Capabilities

None. `settings-shortcuts-and-desktop-integration` already requires that these
routes are presented in-page where native windows are unavailable; this change
specifies what that in-page presentation is, without changing which routes
open or when.

## Impact

- `src/web/ConnectedWebRendererWorkspace.tsx` and
  `connectedRendererWorkspace.css`: `ConnectedBrowserAuxiliaryDialog` and
  `ConnectedBrowserAboutDialog` are replaced by the shared frame.
- New `src/shared/inPageWindow/`: the frame component, a pure geometry model,
  and best-effort geometry storage.
- `src/components/McpInstallModal.tsx`, `src/shared/RemotePairingModal.tsx`,
  `src/components/git-panel/WorktreeSignInDialog.tsx`,
  `src/components/AppUpdateDialog.tsx`, and their stylesheets move onto the
  frame. These components also render inside Desktop's main window, so Desktop
  gets the same frame for them.
- The headings in Settings, Macros, Recordings, Remote Control, and the Edit
  Tab form that repeat the window title are hidden when framed.
- Quick Push has a stylesheet but no dialog of its own, so there is nothing to
  move for it.
- No protocol, server, preload, or Electron main-process change. No new
  dependency.
- Contract tests that assert on `connected-web-auxiliary-*` classes are
  updated.
