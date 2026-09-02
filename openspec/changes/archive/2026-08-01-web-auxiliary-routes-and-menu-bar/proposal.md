## Why

Several shared workspace actions still assumed Electron auxiliary windows:
project-tab and terminal-tab double-click, `open-recordings`, Settings, and
Macros all went through named Desktop preload hosts. The browser host
deliberately omits `nativeWindows`, so those actions silently no-opped or
disappeared even though host-neutral route bodies already existed.

## What Changes

- Introduce a host-neutral auxiliary-route controller owned by the shared
  renderer composition, accepting `settings`, `macros`, `recordings`, and
  `edit-tab` requests with their route state.
- Keep Desktop wiring capability-gated: with `nativeWindows` present, requests
  continue to open the existing native auxiliary windows with their singleton
  and modal behaviour.
- Add browser wiring that renders the same shared route bodies in-page, with
  close, Escape and backdrop dismissal where appropriate, focus return, and
  route-specific save and cancel.
- Add an in-page File/Edit/View/Help menu bar to the connected browser
  workspace with accessible menubar keyboard behaviour and safe equivalent
  commands.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: canonical auxiliary-route presentation per
  host and the per-host application menu.
- `settings-shortcuts-and-desktop-integration`: web route parity for menu and
  editing actions.

## Impact

Shared renderer composition (`AuxiliaryRouteController`), `src/App.tsx`
auxiliary command wiring, `src/web/ConnectedWebRendererWorkspace.tsx`, the
existing host-neutral route bodies (`SharedSettingsRouteBody`,
`SharedMacroRouteBody`, `SharedRecordingsRouteBody`, `SharedEditTabRouteBody`),
`packages/responsive-ui` route render models, and the Electron native menu
command set which the browser menu mirrors without native window roles.
