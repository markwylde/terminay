## Why

Managing Terminay is spread across five places that look alike but behave differently. Settings has a Remote Access page whose main content is a button that opens a second window, Remote Control, with its own sidebar. Macros and Recordings open as their own windows. Extensions sits in Settings but is also listed as a separate File menu item. People end up hunting for where a thing lives, and the File menu holds no files. It is a word-processor idea that has become a junk drawer of management windows.

The underlying problem is that Settings can show only one level: a category and its page. Remote Access, Macros and Extensions each hold a list of things (servers, macros, extensions), so they were given their own windows instead of a second level.

## What Changes

- Settings becomes the single management window, laid out in three columns: a grouped category sidebar, a list column that appears only for categories that hold a list, and the detail pane. A category without a list keeps today's two-column page.
- The category sidebar is grouped under the headings **General**, **Terminal**, **Connections**, **Automation**, **Extensions** and **System**.
- **Remote Access** in Settings holds everything that was in Remote Control: sharing this server (exposure, pairing, approvals, trusted devices, live connections, identity reset, signalling options) and the saved servers this host connects to, including **Add server…**. **BREAKING**: the standalone Remote Control window is removed.
- **Macros** moves into Settings. Its library (grouped by category, filterable) is the list column, and the script editor and live preview are the detail. The macros change set keeps its own Save and Discard. **BREAKING**: the standalone Macros window is removed.
- **Extensions** in Settings uses the list column for installed extensions and an install entry. The separate menu entry goes away.
- **Recordings** leaves the menus and becomes a **Recordings** section in Home's sidebar, directly after Automations. Replays open as Home tabs. **BREAKING**: the standalone Recordings window is removed.
- **BREAKING**: the **File** menu is removed on every host:
  - On macOS, the **Terminay** application menu gains **Settings…** (⌘,), **New Terminal Tab** and **New Project**.
  - On Windows, Linux and the browser in-page menu, the first menu is named **Terminay** and holds **New Terminal Tab**, **New Project**, **Settings…** and **Quit**. In the browser, **Disconnect** replaces Quit where it applies.
- The commands that opened the removed windows still work and now land somewhere else. **Remote Access**, **Macros** (⌘;) and **Extensions** open Settings at that category. **Recordings** (its configurable shortcut) selects Home and brings the Recordings section to the front. The connection menu's manage control and the pending-approval notification open Settings › Remote Access.
- Settings search also matches the items inside list categories: server names, macro names and script text, and extension names.
- Settings uses one spacing scale. The three columns share the same header line, inset and row height, so the window looks like a single piece.

## Capabilities

### New Capabilities

None. The behaviour belongs to existing capabilities.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: application menu structure (no File menu; Terminay menu contents per platform); the management commands now land on Settings categories or Home; the three-column Settings layout, grouped sidebar, list column, search over items, compact presentation and spacing; native auxiliary windows reduced to Settings; Extensions presentation; native menu bar policy wording.
- `connections-and-client-hosts`: Remote Control becomes Settings › Remote Access; the File menu grouping is removed; Pair Device and pending-approval entry points; shared management routes; the browser in-page menu uses Terminay instead of File; Disconnect moves to the Terminay menu.
- `in-page-windows`: the set of resizable, maximisable and geometry-remembering management windows reduces to Settings, and its scenarios are restated.
- `macros`: the Macros window library, script editor, preview, save model and server selection are restated as the Macros category of Settings.
- `recording`: the Recordings timeline entry point becomes a Home section, and replays open as Home tabs.
- `workspace-dashboard`: Home's sidebar has four sections: Home, Tabs, Automations, Recordings.
- `remote-access`: returning to the manager list uses Terminay → Disconnect.
- `extension-platform`: Extensions entry points no longer include a File menu item.
- `local-desktop-diagnostics`: the Performance Log window's presentation family no longer names Macros and Recordings.
- `workspace-and-project-tabs`: the default-project-name scenario no longer refers to the File menu.

## Impact

- **Desktop main process** (`electron/main.ts`): `createAppMenu` is rebuilt for each platform, and the `macros`, `recordings` and `remote-control` entries are removed from the auxiliary routes, along with their window lifecycle.
- **Shared UI**:
  - `src/components/SettingsWindow.tsx` gains the list column and the grouped sidebar.
  - `src/components/MacrosWindow.tsx` and `src/components/ExtensionManager.tsx` become Settings category bodies.
  - `src/shared/SharedConnectionsRouteBody.tsx` and its `RemoteControlWindow.css` become the Remote Access category body.
  - `src/components/RecordingsWindow.tsx` becomes a Home section.
  - `src/shared/auxiliaryRoutes.tsx` and `src/shared/inPageWindow/geometryStore.ts` drop the removed routes.
  - `src/workspace/homeSection.ts` gains `recordings`.
  - The browser menu (`src/web/ConnectedWebRendererWorkspace.tsx`, `src/workspace/WorkspaceDashboard.tsx`) and the command handlers in `src/App.tsx` and `src/keyboardShortcuts.ts` are updated.
- **Protocol and server**: no change. Each category keeps the same server-scoped clients (macros, extensions, exposure, recordings) through the Settings server selector.
- **Tests**:
  - Unit tests for the menu template and Home sections.
  - E2E suites for Settings, Remote Control, Macros, Recordings and menus are updated or replaced through `npm run test:e2e`.
- **Docs**: `docs/product-overview.md` and any operator runbook that says "File → Remote Control".
