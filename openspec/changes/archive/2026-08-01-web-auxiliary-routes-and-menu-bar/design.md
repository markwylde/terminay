## Context

See proposal.md. The investigation found the pieces were already mostly in
place: the connections-and-client-hosts capability already required
browser hosts to keep shared routes in-page and Desktop to use native auxiliary
windows only behind `nativeWindows`; `packages/responsive-ui/src/index.ts`
already mapped `settings`, `recordings`, `macros`, `file`, and `git` to
`native-auxiliary` only when `nativeWindows` exists, leaving browser route
render models as `in-page`; and the four shared route bodies were already
host-neutral and consumed by the Desktop windows. What was missing was a
cross-host command boundary: `src/App.tsx` still routed auxiliary commands
through named Desktop preload hosts, and `ConnectedWebRendererWorkspace`
owned only a Connections dialog.

## Goals / Non-Goals

Goals:
- One auxiliary-route command boundary that both hosts satisfy.
- Browser parity for Settings, Macros, Recordings, project-tab editing, and
  terminal-tab editing without Electron preload globals.
- A visible, accessible browser application menu with safe equivalents of the
  native File/Edit/View/Help commands.

Non-Goals:
- Dragging a tab or project out of the browser page to create another popup
  window.
- `BrowserWindow` lifecycle changes or native OS menu replacement in Electron.
- Browser access to Desktop-only capabilities.

## Decisions

### One controller, two presentations

The controller accepts route requests plus the state each route needs — the
settings section id, the project edit draft, the terminal edit draft. Desktop
delegates to the existing native bridges when `nativeWindows` is declared.
Browser renders the same shared bodies in-page. Direct auxiliary host calls
were removed from shared workspace actions so that project-tab double-click,
terminal-tab double-click, `open-recordings`, Settings, and Macros all have
browser behaviour when `nativeWindows` is absent.

### No Electron shims in the browser

Web project editing persists through `WorkspaceClient` and refreshes
`WorkspaceSnapshotStore`, matching `useProjectEditor` conflict handling and
focus restoration. Web terminal editing updates active terminal panel metadata
through the same server-backed path Desktop results use, without an Electron
modal result channel. Recordings, macros, and settings use the existing shared
and connected-browser clients. No browser shim for a `window.terminay*Host`
global was added.

### Browser menu mirrors commands, not native roles

File offers New Terminal, New Project, Save, Settings, Macros, Recordings, and
Close Terminal where the active workspace target exists. Edit offers
browser-safe undo, redo, cut, copy, paste, and select-all via standard DOM
commands or explicit host actions where available. View offers Set Project Root
to Working Directory and Toggle File Explorer Sidebar; browser zoom, DevTools,
and window-management entries are absent unless a real browser-safe capability
is added. Help offers safe external, documentation, and about actions that pass
no secrets, local paths, terminal output, or pairing fragments to another
origin. Keyboard interaction follows accessible menubar behaviour: arrow
movement, Home/End, Escape close, Enter/Space activation, focus return, and no
focus trap when closed.

## Risks / Trade-offs

- Two presentations of the same routes means Desktop and browser can drift.
  The mitigation is that both consume the same host-neutral bodies and the same
  controller, and static coverage asserts the browser composition introduces
  neither `nativeWindows: true` nor Electron preload globals.
- Existing Electron e2e coverage for native settings, macros, recordings,
  project edit, and terminal edit windows was kept passing unchanged so the
  Desktop journey is provably unaffected.
