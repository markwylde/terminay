## Context

Today Terminay has four management surfaces:

- **Settings** (`src/components/SettingsWindow.tsx`, 2.9k lines) is a two-column surface: a flat category sidebar and a page. Extensions is already one of its categories (`ExtensionSettingsSection`, `ExtensionManager`).
- **Remote Control** (`src/shared/SharedConnectionsRouteBody.tsx` with `RemoteControlWindow.css`) is its own window. Its sidebar has an Exposure entry and a list of saved servers. Settings' Remote Access page holds the signalling options and a button that opens Remote Control.
- **Macros** (`src/components/MacrosWindow.tsx`) is its own window: a library on the left, the editor and preview on the right, and one Save for the whole change set.
- **Recordings** (`src/components/RecordingsWindow.tsx`) is its own window: a timeline with replay.

On Desktop each of these is a native auxiliary window (`AUXILIARY_TITLES` in `electron/main.ts`: `settings`, `macros`, `recordings`, `remote-control`, plus `performance-log`). In a browser each is an in-page management window under ADR-0053. The native menu (`createAppMenu`) has a File menu that opens all of them. The browser's in-page menu mirrors it with `file | edit | view | help` (`src/web/ConnectedWebRendererWorkspace.tsx`, `src/workspace/WorkspaceDashboard.tsx`).

Home already has a sidebar of sections (`src/workspace/homeSection.ts`: `home`, `tabs`, `automations`). Under ADR-0040, its tabs are device-local presentation in their own Dockview.

The approved direction is concept C of the explored mock-ups: one Settings surface whose collection categories get a list column between the sidebar and the detail pane.

## Goals / Non-Goals

**Goals:**
- One place to manage Terminay: Settings, with Remote Access, Macros and Extensions as categories.
- Recordings sits with the other workspace content in Home.
- No File menu. The first menu is Terminay on every host.
- One spacing scale, so the three columns read as one piece.
- Keep every server-scoped client and authority path exactly as it is.

**Non-Goals:**
- No protocol, server or persistence change. Macros, extensions, exposure and recordings keep their current client facades and commands.
- No redesign of the macro script editor, the Pair Device dialog, or the recordings replay player beyond re-hosting them.
- No change to the Edit, View, Terminal, Window or Help menus. About and Check for Updates stay where they are.
- No light-theme rework beyond what the spacing tokens touch.

## Decisions

### 1. Settings gains a list column, driven by category metadata

Each Settings category declares whether it is a *collection*. A collection category supplies:

- a list model: sections, items, a status line for each item, and its add action;
- a detail renderer for the selected item.

`SettingsWindow` renders `sidebar | list | detail` for collections and `sidebar | page` for everything else. The selected item for each category is kept in Settings component state for as long as Settings is open (spec: "Settings list column").

*Alternatives:*
- A tree sidebar (concept A) gets long once there are twenty macros.
- Drill-down (concept B) costs a click for every server and macro.
- Accordions (concept D) cramp the macro editor.
- The overview with sheets (concept E) is the furthest from the current code.

The list column also mirrors the layout people already know from the Remote Control and Macros windows.

*Boundary:* none crossed. This is renderer presentation only.

### 2. Remote Access merges the exposure page and the saved-server list

The **This server** item renders the existing exposure cards from `SharedConnectionsRouteBody` and adds the signalling options that sit on Settings' current `remote-access-host` section. All of them act on the server chosen in the Settings server selector.

**Saved servers** is a different kind of data. It comes from the host's connection list, the same source Remote Control uses today (`SavedServerSummary` / `ConnectionProfileStore` via host actions). It does not follow the selector.

*Boundary:* this puts host-owned connection data next to server-scoped data in one surface. The two keep separate clients:
- Exposure, approvals, trusted devices and identity reset go only through the selected server's connection, gated by the same `canExpose` / `canRevoke` capabilities.
- Saved servers go only through the host action. On a framed `app.terminay.com` session the manager owns saved profiles, so Saved servers lists only the window's attached connections there, exactly as Remote Control does today.

The spec scenario "Saved servers do not follow the selector" pins this split.

Each trusted device gets a readable name ("iPhone · Safari 27") parsed from its stored user agent in the renderer. The raw string stays one click away. This is display only, and authority is unchanged.

### 3. Macros moves in whole, with its own change set

`MacrosWindow` is split along its existing seam:
- the library becomes the list column body, with the filter in the column header;
- the editor and preview become the detail.

The pending change set stays in a Macros-scoped store that lives as long as Settings, so moving to another category keeps edits.

Settings already saves ordinary settings as they change. Macros keeps an explicit Save/Discard bar at the top of its detail pane, because a macro edit is a multi-field document and the server validates the whole set.

Closing Settings or switching the server selector with pending macro edits raises the existing in-frame confirmation (ADR-0053 lets a window refuse dismissal through the frame).

*Alternative:* autosave macros like other settings. It was rejected because a half-typed script would be sent to the server and rejected repeatedly, and the spec already promises one atomic Save.

*Boundary:* the macro settings client is still passed explicitly for the selected server (spec "Server-authoritative file and macro definitions"). No ambient context is introduced.

### 4. Extensions uses the list column for installed packages

The list column contains:
- an **Install** item, which shows the npm and package-file install forms in the detail pane;
- the installed extensions, each showing built-in or custom and whether it is enabled.

An extension's detail shows its enable toggle, its permissions and the settings sections it contributes, which `ExtensionSettingsSection` already renders. The custom install review flow (extension-platform) still opens as a dialog over Settings.

### 5. Recordings becomes a Home section

`HOME_SECTIONS` becomes `['home', 'tabs', 'automations', 'recordings']`. The timeline body from `RecordingsWindow` renders as the Recordings Home tab, and a replay opens as a Home tab keyed by recording id, which de-duplicates it.

The Recordings command keeps its id (`open-recordings`) and shortcut binding but now dispatches "select Home, focus section `recordings`". The Recordings server selector follows the Automations section's pattern.

*Boundary:* Home tabs are device-local presentation (ADR-0040). The recordings client is still the canonical `RecordingsClient` of the selected server. Only the frame around the timeline changes.

### 6. Removed windows and routes

These auxiliary routes are deleted:
- the `macros`, `recordings` and `remote-control` entries in `AUXILIARY_TITLES` and `canonicalAuxiliaryRequest`;
- `src/shared/auxiliaryRoutes.tsx`;
- the in-page geometry ids in `src/shared/inPageWindow/geometryStore.ts`.

The commands `open-remote-control`, `open-macros` and `open-extensions` stay as named commands, so key bindings and Command Bar entries survive. They now present the `settings` route with a category (and optional item) parameter. The `settings` route already accepts an initial category from its URL (`initialCategoryFromUrl`). It gains an `item` parameter.

A Desktop route request for a removed kind is refused like any unknown kind. Nothing outside the bundle depends on those kinds.

*Boundary:* the Desktop host route allow-list shrinks. No new host action is added.

### 7. Menus

`createAppMenu` changes as follows:
- **macOS:** inserts Settings… (⌘,), New Terminal Tab and New Project into the existing `Terminay` submenu, and drops `File`.
- **Windows and Linux:** gets a new first submenu, labelled `Terminay`, holding New Terminal Tab, New Project, Settings… (Ctrl+,) and Quit.
- **Browser:** the in-page `BrowserMenuId` `file` becomes `terminay`, labelled "Terminay". Its compact grouped menu follows.

Item labels become **New Terminal Tab** and **New Project** in the menu and Command Bar. Command ids are unchanged, so user key bindings are preserved.

*Linux convention check:* GNOME and KDE apps commonly lead with the application-named or "File" menu. Electron apps such as Slack and Discord lead with the app name. Choosing Terminay keeps one vocabulary across hosts and matches the user's request.

### 8. One spacing scale for Settings

`src/settings.css` gains layout tokens next to its colour tokens:

- `--settings-space-1 … -6` = 4, 8, 12, 16, 24, 32 px
- `--settings-inset` = 16 px (the column inset)
- `--settings-header-height` = 52 px (the shared header line)
- `--settings-nav-row` = 32 px (sidebar row)
- `--settings-list-row` = 52 px (two-line list row)
- `--settings-row-pad` = 12 px × 16 px (setting row)

Column widths: sidebar 232 px, list 264 px, detail flexible with a 420 px minimum. The three-column layout therefore needs about 920 px. Below that width, Settings switches to the one-column-at-a-time presentation (spec "Settings in a narrow window"). The default Settings size grows to fit three columns where the viewport allows.

Every column header (Settings title and server selector, list header, detail heading) sits in a `--settings-header-height` band, which gives the aligned header line the spec requires. The CSS from Remote Control, Macros and Extensions is folded into these tokens and their duplicates are deleted, so there is one set of card, row and button styles.

*Alternative:* adopt a CSS framework or a component library. It was rejected because the repository has one hand-written settings stylesheet and the problem is inconsistency, not missing primitives.

## Risks / Trade-offs

- [The 2.9k-line `SettingsWindow.tsx` grows further] → Extract the shell (sidebar, list column, header band, narrow-mode stack) into `src/components/settings/SettingsShell.tsx`. Each collection category lives in its own module (`settings/RemoteAccessCategory.tsx`, `settings/MacrosCategory.tsx`, `settings/ExtensionsCategory.tsx`), so SettingsWindow only registers categories.
- [People with muscle memory for File → Remote Control or ⌘; to a separate window] → Command ids and accelerators are unchanged, and ⌘; still opens macros, now in Settings. The Command Bar entries keep their names.
- [Macro edits lost when Settings closes] → The close confirmation (Decision 3) and an e2e scenario cover it.
- [A Settings window that is too small on small laptops once it has three columns] → Narrow mode, and the default size is clamped to the viewport by the existing geometry model.
- [The e2e suites for Remote Control, Macros and Recordings windows break wholesale] → They are rewritten against Settings categories and the Home section in the same change. The PR is not finished until all Gitea statuses pass.
- [The saved servers list and the server selector confuse people ("which server am I looking at?")] → The section labels name it: **This server** shows the selected server's name, and **Saved servers** has quiet copy saying these are the servers this computer connects to.

## Migration Plan

This is a single release with no data migration. Stored macro, exposure, extension and recording state is untouched.

The remembered in-page geometry for `macros`, `recordings` and `remote-control` becomes unused. The geometry store ignores unknown ids, so nothing needs cleaning. Remembered Settings geometry smaller than the new default is still honoured.

Rollback means reverting the release. No server or protocol change needs reverting.

## Open Questions

- None blocking. Two choices are deliberate and can be revisited without spec churn: Check for Updates stays in Help on macOS rather than moving to the Terminay menu, and About stays in Help on Windows and Linux.
