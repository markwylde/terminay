# Web auxiliary routes and menu bar

## Goal

Make Settings, Macros, Recordings, project-tab editing, terminal-tab editing,
and the application menu usable in both Desktop and web mode while preserving
Desktop's existing native-window behaviour.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Recording](../features/recording.md)
- [Macros](../features/macros.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

The shared workspace renderer still has several user actions that assume
Electron auxiliary windows:

- project tab double-click calls `useProjectEditor`, which currently depends
  on `window.terminayProjectEditHost?.open(...)`;
- terminal tab double-click routes through the Desktop terminal edit-window
  capability;
- `open-recordings` calls `window.terminayRecordingsHost?.open()`;
- Settings and Macros are reachable from the Electron native menu, but the web
  connected workspace has no visible File/Edit/View/Help menu surface; and
- the browser host deliberately omits `nativeWindows`, so these actions no-op
  or disappear even though shared in-page route bodies already exist.

Electron can keep its current native windows. The web version must implement a
browser-owned auxiliary presenter that renders the same shared route bodies
in-page and a browser menu bar that dispatches the same safe command vocabulary.

Out of scope: dragging a tab/project out of the browser page to create another
popup window, BrowserWindow lifecycle changes, native OS menu replacement in
Electron, or browser access to Desktop-only capabilities.

## Implementation status

Implemented in this worktree: the shared renderer now uses an
`AuxiliaryRouteController`; Desktop delegates to existing native bridges when
available; web injects an in-page presenter with File/Edit/View/Help menus;
Settings, Macros, Recordings, and edit-tab actions render in the browser without
Electron preload globals. Focus returns to the invoking element when the browser
dialog closes.

## Investigation summary

- `specs/features/connections-and-client-hosts.md` already requires browser
  hosts to keep shared routes in-page and Desktop to use native auxiliary
  windows only behind `nativeWindows`.
- `packages/responsive-ui/src/index.ts` maps `settings`, `recordings`,
  `macros`, `file`, and `git` to `native-auxiliary` only when
  `nativeWindows` exists; browser route render models stay `in-page`.
- `src/shared/SharedSettingsRouteBody.tsx`,
  `src/shared/SharedMacroRouteBody.tsx`,
  `src/shared/SharedRecordingsRouteBody.tsx`, and
  `src/shared/SharedEditTabRouteBody.tsx` are already host-neutral and are
  consumed by the Desktop windows.
- `src/web/ConnectedWebRendererWorkspace.tsx` composes the real shared
  `ConnectedRendererWorkspace`, but currently owns only a Connections dialog.
  It does not provide a general auxiliary-route presenter or menu bar.
- `src/App.tsx` still routes auxiliary commands through named Desktop preload
  hosts (`terminayProjectEditHost`, `terminayRecordingsHost`,
  terminal edit host paths) rather than through a cross-host auxiliary-route
  service.
- `electron/main.ts` creates the canonical native menu command set: File,
  Terminal, Edit, View, and OS/window roles. The browser should mirror
  equivalent File/Edit/View/Help commands, not native window roles.

## Work slices

### Auxiliary-route command boundary

- [x] Introduce a host-neutral auxiliary-route controller owned by the shared
  renderer composition. It accepts route requests for `settings`, `macros`,
  `recordings`, and `edit-tab` plus required route state such as settings
  section id, project edit draft, or terminal edit draft.
- [x] Keep Desktop wiring capability-gated: when `nativeWindows` exists,
  Settings/Macros/Recordings/edit requests continue to call the existing
  Desktop native host bridges and preserve singleton/modal behaviour.
- [x] Add browser wiring that renders the same route requests in-page without
  creating popup windows. The presenter must support close, Escape/backdrop
  close where appropriate, focus return, and route-specific save/cancel.
- [x] Replace direct auxiliary host calls from shared workspace actions with
  the controller. In particular, project-tab double-click, terminal-tab
  double-click, `open-recordings`, Settings, and Macros must all have browser
  behavior when `nativeWindows` is absent.

### Browser route bodies

- [x] Reuse existing host-neutral bodies:
  `SharedSettingsRouteBody`, `SharedMacroRouteBody`,
  `SharedRecordingsRouteBody`, and `SharedEditTabRouteBody`.
- [x] For web project editing, persist through `WorkspaceClient` and refresh
  `WorkspaceSnapshotStore`, matching `useProjectEditor` conflict handling and
  focus restoration.
- [x] For web terminal editing, update the active terminal panel metadata
  through the same application state/server-backed path used by Desktop
  results, without requiring an Electron modal result channel.
- [x] For web recordings/macros/settings, use the existing shared clients and
  compatibility-free connected-browser clients where available; do not add
  browser shims for Electron preload globals.

### Browser application menu bar

- [x] Add an in-page menu bar to the connected browser workspace with File,
  Edit, View, and Help menus.
- [x] File includes New Terminal, New Project, Save, Settings, Macros,
  Recordings, and Close Terminal where the active workspace target exists.
- [x] Edit includes browser-safe undo/redo/cut/copy/paste/select-all behavior,
  using standard DOM commands or explicit host actions only where available.
- [x] View includes Set Project Root to Working Directory and Toggle File
  Explorer Sidebar. Browser zoom/devtools/window-management entries are absent
  unless a real browser-safe capability is added.
- [x] Help includes safe external/documentation/about actions that do not pass
  secrets, local paths, terminal output, or pairing fragments to another
  origin.
- [x] Menu keyboard interaction follows accessible menubar behavior: arrow
  movement, Home/End, Escape close, Enter/Space activation, focus return, and
  no focus trap when closed.

### Tests and evidence

- [x] Add unit/static coverage proving `src/web/ConnectedWebRendererWorkspace.tsx`
  has a browser auxiliary presenter and does not introduce
  `nativeWindows: true` or Electron preload globals.
- [x] Add focused tests for the auxiliary controller: Desktop delegates to
  native bridges when capable; web opens in-page routes when not capable.
- [x] Keep existing Electron e2e coverage for native settings/macros/
  recordings/edit windows passing unchanged. Evidence:
  `e2e/settings.spec.ts`, `e2e/macros.spec.ts`, `e2e/recordings.spec.ts`,
  `e2e/project-tabs.spec.ts`, `e2e/terminal.spec.ts`, and
  `e2e/support/ui.ts` cover the native Settings, Macros, Recordings, project
  edit, and terminal edit window paths.

## Definition of done

- In Electron, Settings, Macros, Recordings, project-tab editing, and
  terminal-tab editing still open native auxiliary windows/modals as they do
  today.
- In web mode, the same actions open visible in-page surfaces and can save or
  cancel without depending on `window.terminay*Host` globals.
- The connected browser workspace exposes a visible File/Edit/View/Help menu
  bar with safe equivalent commands.
- The implementation does not support or imply browser popup windows for
  dragging tabs/projects out of the page.
- Automated tests cover both Desktop capability-gated delegation and browser
  in-page fallback behavior.
