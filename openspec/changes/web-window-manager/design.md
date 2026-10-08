## Context

Where the host has no `nativeWindows` capability, `ConnectedWebRendererWorkspace`
presents secondary routes itself. It has two private components for that:
`ConnectedBrowserAuxiliaryDialog` (Settings, Macros, Recordings, Remote Control,
Edit Tab/Project) and `ConnectedBrowserAboutDialog`. Both are a fixed, centred
`<section role="dialog">` inside a blurred backdrop, sized by per-route CSS
(`min(1480px, 100%)` for Settings and so on). The first draws an `<h2>` and a
"Close" text button, except for `edit-tab` where it draws nothing; the second
draws an absolutely positioned × over a sandboxed iframe. Separately,
`McpInstallModal`, `RemotePairingModal`, `WorktreeSignInDialog`, and
`AppUpdateDialog` each own a backdrop, a frame, a
close control, and an Escape handler. Those four render inside the workspace
tree on every host, Desktop's main window included.

`src/workspace/appWindows/` already has pointer-driven move and resize for
agent app windows (`windowLayout.ts`: `rectAfterResize`, `ResizeEdges`,
`WindowRect`, a 4 px drag threshold). Its layout is pane-relative, has tabs,
sheets, and a rail, and belongs to a terminal session; it is not a general
window frame.

`src/workspace/localViewState.ts` is the precedent for per-device view state in
`localStorage`: best-effort, validated on read, never sent anywhere.

Decided with the owner before design: windows stay modal and one at a time; no
minimise; maximise yes; geometry remembered per browser; the small dialogs
move onto the frame in this change.

In-force ADRs that bear on this: ADR-0005 (sandboxed, origin-bound client
hosts), ADR-0011 (trust-boundary model), ADR-0047 (a window is one server
running the host bundle). Nothing here diverges from them.

## Goals / Non-Goals

**Goals:**

- One frame component that every in-page window and dialog renders through.
- Move, resize, maximise, and remembered geometry for the management windows.
- Correct behaviour at every viewport size, including compact and live browser
  resizes.
- No change to what opens, when, or with what data.

**Non-Goals:**

- Non-modal windows, more than one top-level window at a time, z-order
  management between siblings, minimise, snapping, or tiling.
- Changing Desktop's native auxiliary windows.
- Reframing confirmation prompts (`alertdialog`), the Command Bar, the compact
  switcher, the shell-profile editor, the macro parameter prompt, or agent app
  windows.
- Moving or resizing by keyboard. Maximise is the keyboard-reachable sizing
  control.
- Restyling the content of any window beyond removing duplicated headings and
  close buttons.

## Decisions

### 1. One `InPageWindow` component in `src/shared/inPageWindow/`

A single React component owns backdrop, frame, title bar, close and maximise
buttons, resize handles, focus trap, Escape, and focus return. Callers pass
`title`, `onClose`, `children`, and a `kind`:

- `kind: { resizable: true, id, defaultSize, minSize }` for the four management
  windows. `id` is the storage key.
- `kind: { resizable: false, width }` for content-sized windows; height comes
  from content, capped at the viewport.

It lives in `src/shared/` because both `src/web/` and the workspace components
under `src/components/` need it.

*Alternative: keep the per-dialog frames and share only CSS.* Rejected: the
inconsistency being fixed is exactly the repeated copies of backdrop, Escape, and focus
logic that drifted. *Alternative: a windowing library (react-rnd, floating
panels).* Rejected: the behaviour needed is a few hundred lines, the repository
already has the resize arithmetic, and a dependency would bring its own DOM and
styling opinions.

Boundary: none crossed. The component is renderer-only UI, uses no preload API,
and adds nothing to the host capability contract.

### 2. Geometry is a pure model, separate from the component

`geometry.ts` exports pure functions over `{ x, y, width, height }` and a
viewport size: `defaultRect`, `clampToViewport`, `rectAfterMove`,
`rectAfterResize`, and `fitRemembered`. The reachability rule (full title bar
height and 160 px of its width inside the viewport), the 480 × 320 minimum, and
the viewport maximum live here and nowhere else. The component holds the rect in
state and calls the model from pointer handlers.

`rectAfterResize` and `ResizeEdges` are lifted from
`src/workspace/appWindows/windowLayout.ts` into the shared model and
`windowLayout.ts` re-exports them, so there is one implementation. The
app-window constants (220 px minimum, pane-relative clamping) stay where they
are; the function takes its minimums as arguments.

*Alternative: compute geometry with CSS (`resize: both`, `max-width`).*
Rejected: CSS `resize` only offers the bottom-right corner, cannot be clamped
to keep a title bar reachable, and cannot be persisted or restored.

### 3. Pointer handling uses pointer capture, not window listeners

Title bar and resize handles call `setPointerCapture` on `pointerdown`. A drag
begins after 4 px of travel, matching app windows. Capture keeps events flowing
while the pointer is over the About iframe or outside the browser window, which
is what makes dragging over embedded content work without toggling
`pointer-events` on iframes. Position and size are `left`, `top`, `width`, and
`height` on the frame, written directly to the element's style during the drag
and committed to React state on `pointerup`, so a drag does not re-render
Settings on every frame.

The frame is never given a `transform`, `filter`, or `contain`, and the blurred
backdrop is its sibling rather than its ancestor. Any of those would make the
frame the containing block for `position: fixed` descendants, and a dialog
opened from inside a window is such a descendant: it would be laid out inside
its parent instead of over the viewport.

Backdrop dismissal listens for `pointerdown` whose target is the backdrop
itself, so a resize or text selection that ends over the backdrop does not
close the window.

### 4. Modality stays, with a stack for nested dialogs

A module-level stack records open `InPageWindow` instances in mount order. Only
the top entry handles Escape, and it leaves the key alone when something inside
the window has already called `preventDefault` on it. Focus is held by a guard
element at each end of the frame that hands focus to the other end, so Tab
cycles inside the window, including out of a framed document such as About.
Lower windows are not marked `inert`: a nested dialog is a DOM descendant of
the window that opened it and would become inert with it; the upper backdrop
already takes the pointer. A window also takes a `busy` flag, during which the
close button is disabled and Escape and the backdrop do nothing; worktree
sign-in sets it while it saves. Each
level renders its own backdrop, at a lighter opacity above the first so stacked
dialogs do not turn the page black. This replaces the per-dialog
`window.addEventListener('keydown')` handlers, which today all fire for one
Escape.

`AppUpdateDialog` and other dialogs raised from the workspace use the same
stack, so a dialog raised while Settings is open lands above it.

*Alternative: the native `<dialog>` element with `showModal()`.* It gives a
free top layer, focus trap, and `inert` page. Rejected for now because
top-layer elements sit above the workspace's own portalled menus and toasts,
several of which must appear over an open window (select popups inside
Settings, the dictation overlay), and auditing those is a larger change than
this one.

### 5. Geometry is stored per window id in `localStorage`

Key `terminay.view.in-page-window.v1`, value
`{ [id]: { x, y, width, height, maximized } }` for the four management ids.
Read once on open, validated field by field (finite numbers, boolean), then
passed through `fitRemembered` against the current viewport. Written on
`pointerup`, on maximise toggle, and on close. All access is wrapped the way
`localViewState.ts` wraps it; failure means defaults.

Boundary: this is transient client state under the settings authority
classification in `settings-shortcuts-and-desktop-integration`, in the same
family as native window geometry on Desktop. It is keyed by window id only,
never by server, project, or session, so it carries nothing across the
project/window security boundary and contains no server data. It is stored on
the origin the bundle is served from, which ADR-0005 already binds to one
server.

*Alternative: a server setting, so geometry follows the user between browsers.*
Rejected: a rectangle is meaningful only for the viewport it was made in, and
the settings spec assigns window geometry to the connection host.

### 6. Viewport changes are handled by one resize observer

The component observes the viewport. On change it re-runs `clampToViewport` on
the user's rect and renders the result, but keeps the user's rect as the
source of truth, so narrowing and then widening the browser gives the original
placement back. Below the compact breakpoint (the existing compact-chrome
breakpoint, read from the same source the chrome uses) the frame takes a
`data-compact` attribute: it fills the viewport, hides the maximise button and
resize handles, and ignores title bar drags. Compact is a rendering of the same
state, so leaving compact restores the window.

Maximised is likewise a flag over the stored rect, not a replacement for it.

### 7. Visual language

Title bar 36 px (44 px compact, for touch), title at the leading edge, controls
at the trailing edge as 28 px icon buttons with visible focus rings. Frame
tokens (border `#2a3542`, radius 10 px, the existing shadow, backdrop
`rgba(3, 5, 9, 0.7)` with blur) are taken from the current auxiliary dialog so
the result looks like the best of what exists, declared once as CSS custom
properties on the frame. Resize handles are 6 px invisible strips on edges and
12 px squares on corners, outside the content box so they never cover content.
A 120 ms fade on open, removed under `prefers-reduced-motion: reduce`. There is
no rise: it would need a transform on the frame (decision 3).

Settings, Macros, Recordings, Remote Control, and the Edit Tab form each render
a heading that repeats the title. Inside the frame that heading is hidden by a
rule scoped to the frame's body, so the components take no new prop and
Desktop's native windows, which are not framed, keep it.

### 8. The About iframe is unchanged

About keeps its `sandbox="allow-popups allow-popups-to-escape-sandbox"` iframe
and `srcDoc`. Only the element around it changes. Boundary: the sandbox
attribute and the link allowlist in `aboutWindowDocument.ts` are the security
boundary for that document and are not touched.

## Risks / Trade-offs

- [Small dialogs change on Desktop too, because they are the same components]
  → Intended and stated in the proposal; covered by the existing Desktop E2E
  suites for MCP install and pairing.
- [E2E and script tests select `connected-web-auxiliary-*` classes] → Keep the
  `data-connected-web-auxiliary-route` attribute on the frame and update class
  selectors in the same change.
- [Removing a dialog's own Escape handler could strand a dialog whose close has
  side effects, such as resolving a pending edit promise] → `onClose` is the
  only close path; each migrated dialog passes its existing cancel function.
- [A remembered rect from a large monitor opens badly on a laptop] →
  `fitRemembered` on every open; covered by a unit test.
- [Direct style writes during drag drift from React state] → State is committed
  on `pointerup` and on `pointercancel`; a cancelled drag reverts to the rect it
  started from.
- [Escape, backdrop, and close are now uniform] → Worktree sign-in used to
  ignore a backdrop press; it now treats one as "ask me later", the same as
  Escape always did.

- [Content-sized windows that grow after opening, such as a pairing dialog that
  reveals a QR code] → Height is never fixed for these; the frame re-clamps
  position when its content box changes size.

## Migration Plan

One change, no data migration. Rollback is reverting the commit; a leftover
`terminay.view.in-page-window.v1` key is ignored by older bundles.

## Open Questions

None.
