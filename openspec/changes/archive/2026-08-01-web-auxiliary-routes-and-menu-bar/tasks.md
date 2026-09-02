## 1. Auxiliary-route command boundary

- [x] 1.1 Introduce a host-neutral auxiliary-route controller owned by the shared renderer composition, accepting `settings`, `macros`, `recordings`, and `edit-tab` requests plus their route state, verified by focused controller tests
- [x] 1.2 Keep Desktop wiring capability-gated so that with `nativeWindows` present the requests continue to call the existing native host bridges and preserve singleton and modal behaviour, verified by the controller delegation tests and unchanged Electron e2e coverage
- [x] 1.3 Add browser wiring that renders the same route requests in-page with close, Escape and backdrop dismissal, focus return, and route-specific save and cancel, verified by the browser presenter tests
- [x] 1.4 Replace direct auxiliary host calls from shared workspace actions with the controller so project-tab double-click, terminal-tab double-click, `open-recordings`, Settings, and Macros all have browser behaviour when `nativeWindows` is absent, verified by the controller tests

## 2. Browser route bodies

- [x] 2.1 Reuse `SharedSettingsRouteBody`, `SharedMacroRouteBody`, `SharedRecordingsRouteBody`, and `SharedEditTabRouteBody` unchanged, verified by the browser presenter rendering the same components
- [x] 2.2 Persist web project editing through `WorkspaceClient` and refresh `WorkspaceSnapshotStore`, matching `useProjectEditor` conflict handling and focus restoration, verified by the project-edit browser tests
- [x] 2.3 Update active terminal panel metadata for web terminal editing through the same server-backed path Desktop uses, without an Electron modal result channel, verified by the terminal-edit browser tests
- [x] 2.4 Use the existing shared and connected-browser clients for recordings, macros, and settings and add no browser shims for Electron preload globals, verified by the static composition check

## 3. Browser application menu bar

- [x] 3.1 Add an in-page File/Edit/View/Help menu bar to the connected browser workspace, verified by the menu bar tests
- [x] 3.2 Include New Terminal, New Project, Save, Settings, Macros, Recordings, and Close Terminal under File where the active workspace target exists, verified by the menu model tests
- [x] 3.3 Include browser-safe undo, redo, cut, copy, paste, and select-all under Edit using standard DOM commands or explicit host actions only where available, verified by the menu model tests
- [x] 3.4 Include Set Project Root to Working Directory and Toggle File Explorer Sidebar under View, with no browser zoom, DevTools, or window-management entries, verified by the menu model tests
- [x] 3.5 Include safe external, documentation, and about actions under Help that pass no secrets, local paths, terminal output, or pairing fragments to another origin, verified by the menu model tests
- [x] 3.6 Follow accessible menubar keyboard behaviour with arrow movement, Home/End, Escape close, Enter/Space activation, focus return, and no focus trap when closed, verified by the menu bar keyboard tests

## 4. Tests and evidence

- [x] 4.1 Add unit and static coverage proving `src/web/ConnectedWebRendererWorkspace.tsx` has a browser auxiliary presenter and introduces neither `nativeWindows: true` nor Electron preload globals, verified by the static composition test
- [x] 4.2 Add focused tests for the auxiliary controller covering Desktop delegation when capable and in-page routes when not, verified by the controller tests
- [x] 4.3 Keep existing Electron e2e coverage for native settings, macros, recordings, and edit windows passing unchanged, verified by `e2e/settings.spec.ts`, `e2e/macros.spec.ts`, `e2e/recordings.spec.ts`, `e2e/project-tabs.spec.ts`, `e2e/terminal.spec.ts`, and `e2e/support/ui.ts`
