## REMOVED Requirements

### Requirement: Extensions presentation in Settings

**Reason**: Remote Access and Macros joined Extensions as Settings categories, so the requirement covers all three.
**Migration**: See "Management categories in one Settings surface".

### Requirement: Management surface commands

**Reason**: The management windows it opened are now Settings categories or a Home section.
**Migration**: See "Management commands open Settings".

## ADDED Requirements

### Requirement: Management categories in one Settings surface

Extensions, Remote Access, and Macros SHALL each be a category of the one Settings surface, and every command that targets one of them SHALL focus that category instead of opening a separate window or modal. Invoking such a command while Settings is open SHALL reuse the open Settings surface.

#### Scenario: Extension command invoked

- **WHEN** any extension command is invoked
- **THEN** the Settings surface focuses its Extensions category and no Extensions-only modal is created

#### Scenario: Settings is reused

- **WHEN** Remote Access is invoked repeatedly on Desktop
- **THEN** the same Settings window is focused at Remote Access and no second window opens

### Requirement: Management commands open Settings

The Command Bar SHALL expose **New Terminal Tab**, **New Project**, **Settings**, **Remote Access**, **Macros**, **Extensions**, and **Recordings** through the same semantic route and command model as the application menu. **Settings** SHALL open Settings, or focus it if it is open, at the category it last showed. **Remote Access**, **Macros**, and **Extensions** SHALL open or focus Settings at that category. **Macros** SHALL keep the default accelerator `CmdOrCtrl+;`. **Recordings** SHALL select Home in the focused workspace and bring its Recordings section to the front. Each command SHALL be rebindable in the shortcut settings surface. Settings SHALL manage the selected Terminay Server and the host's saved servers, never project or tab editor sheet chrome.

#### Scenario: Opening Remote Access

- **WHEN** a user invokes Remote Access from the Command Bar or its accelerator
- **THEN** Settings opens, or is focused, at Remote Access

#### Scenario: Opening Macros with its shortcut

- **WHEN** a user presses `CmdOrCtrl+;`
- **THEN** Settings opens, or is focused, at Macros

#### Scenario: Opening Recordings

- **WHEN** a user invokes Recordings
- **THEN** Home is selected and its Recordings section is in front

#### Scenario: Web management routes

- **WHEN** a user invokes any of these commands on the web host
- **THEN** the in-page Settings route opens at the matching category, or Home shows Recordings

### Requirement: Terminay application menu

The first application menu on every host SHALL be named **Terminay** and SHALL hold the workspace creation commands and Settings. There SHALL be no **File** menu on any host.

On macOS the **Terminay** application menu SHALL list, in order: **About Terminay**; **Settings…** with `Cmd+,`; **New Terminal Tab** and **New Project** with their configured accelerators; the system **Services** submenu; **Hide Terminay**, **Hide Others**, and **Show All**; and **Quit Terminay**. Separators SHALL divide these groups.

On Windows and Linux the native **Terminay** menu SHALL list **New Terminal Tab** and **New Project**, then **Settings…** with `Ctrl+,`, then **Quit**, with separators between the groups.

In a browser host's in-page menu, **Terminay** SHALL list **New Terminal Tab**, **New Project**, and **Settings…**. Where the session can return to the `app.terminay.com` manager, it SHALL end with **Disconnect** in its own group. It SHALL list no command that the browser cannot perform.

Every entry SHALL dispatch the same named command as the Command Bar and the keyboard accelerator.

#### Scenario: macOS application menu

- **WHEN** a macOS user opens the Terminay menu
- **THEN** it lists About Terminay, Settings… with Cmd+,, New Terminal Tab, New Project, Services, the hide commands, and Quit Terminay, and the menu bar has no File menu

#### Scenario: Linux or Windows first menu

- **WHEN** a Linux or Windows user opens the first menu of a project window
- **THEN** it is named Terminay and lists New Terminal Tab, New Project, Settings… with Ctrl+,, and Quit

#### Scenario: Browser in-page menu

- **WHEN** a browser user opens the in-page menu
- **THEN** its first menu is Terminay with New Terminal Tab, New Project, and Settings…, and there is no File menu

#### Scenario: Creating a tab from the Terminay menu

- **WHEN** a user chooses New Terminal Tab from the Terminay menu
- **THEN** the same command runs as when the configured accelerator is pressed

### Requirement: Settings list column

Settings SHALL present a category whose content is a collection as three columns: the category sidebar, a list column of that category's items, and a detail pane for the selected item. The collection categories SHALL be **Remote Access** (this server's sharing and the saved servers), **Macros**, and **Extensions** (installed extensions and an install entry). Every other category SHALL present as two columns, the category sidebar and its page, with no list column. The list column SHALL carry the category name and the category's add action in its header. Within the column, items SHALL be grouped under section labels where the category defines them. Each item row SHALL show the item's name and one line of status. Opening a collection category SHALL select its first item, or the item it was opened at. Settings SHALL remember the selected item of each collection category for as long as Settings stays open.

#### Scenario: Opening Remote Access

- **WHEN** a user selects Remote Access in the Settings sidebar
- **THEN** a list column appears with this server's sharing under one section label and the saved servers under another, with Add server… in its header, and the detail pane shows the first item

#### Scenario: A category without a list

- **WHEN** a user selects Appearance
- **THEN** Settings shows the sidebar and the Appearance page with no list column

#### Scenario: Returning to a collection

- **WHEN** a user selects a saved server, opens Appearance, and returns to Remote Access
- **THEN** the same saved server is selected

### Requirement: Grouped Settings sidebar

The Settings sidebar SHALL list categories under the group labels **General**, **Terminal**, **Connections**, **Automation**, **Extensions**, and **System**, in that order. **Remote Access** SHALL sit under Connections, **Macros** and **Recording** under Automation, **Extensions** under Extensions, and **Updates** and **Diagnostics** under System. A category that is not available on the current host or server SHALL be omitted, and a group left empty SHALL be omitted with it. A collection category SHALL show the count of its items beside its name.

#### Scenario: Group order

- **WHEN** a user opens Settings
- **THEN** the sidebar shows General, Terminal, Connections, Automation, Extensions, and System in that order, with Remote Access under Connections and Macros under Automation

#### Scenario: Unavailable category

- **WHEN** Diagnostics is unavailable on the current host
- **THEN** System lists Updates only

### Requirement: Settings search reaches list items

The Settings search SHALL match setting labels and descriptions, and also the items of collection categories: saved server names, macro names, descriptions, and script text, and extension names. A matching item SHALL appear under its category in the search results, and choosing it SHALL open that category with the item selected.

#### Scenario: Finding a macro by its script

- **WHEN** a user searches Settings for a word that appears only in one macro's script
- **THEN** the results include that macro under Macros, and choosing it opens Macros with that macro selected

#### Scenario: Finding a saved server

- **WHEN** a user searches Settings for "pop"
- **THEN** the saved server pop-os appears under Remote Access

### Requirement: Settings in a narrow window

When Settings is too narrow to show its sidebar, list column, and detail pane at their minimum widths, it SHALL show one column at a time. Each column SHALL have a back control that returns to the previous column, and the back control SHALL be labelled with the previous column's title. A category without a list SHALL go straight from the sidebar to its page. Widening Settings again SHALL restore the full layout with the same category and item selected. On a compact viewport Settings SHALL always use this presentation.

#### Scenario: Narrow window

- **WHEN** Settings is narrowed below the width needed for three columns and the user chooses Macros and then a macro
- **THEN** the sidebar, the macro list, and the macro editor are shown one after another, each with a back control

#### Scenario: Widening again

- **WHEN** the user widens Settings while a macro's editor is shown alone
- **THEN** the sidebar, macro list, and that macro's editor are shown together

### Requirement: Settings layout consistency

Settings SHALL lay out every column on one spacing scale. The sidebar, the list column, and the detail pane SHALL share one header baseline. Within each column, headings, group labels, rows, and empty-state text SHALL share that column's horizontal inset. Item rows in the sidebar and in the list column SHALL have one row height each, whatever their content. Setting rows in the detail pane SHALL share one inner padding and one control alignment. Selecting an item SHALL NOT move or resize any column.

#### Scenario: Aligned headers

- **WHEN** Settings shows Remote Access with three columns
- **THEN** the Settings title, the Remote Access list header, and the detail heading sit on the same header line

#### Scenario: Stable columns

- **WHEN** the user selects a different item in the list column
- **THEN** the widths and positions of all three columns are unchanged

## MODIFIED Requirements

### Requirement: Application menu presentation

Native menus, macOS and Linux integration, external links, reveal actions, and application lifecycle SHALL be coordinated by Electron. Browser hosts SHALL provide a visible in-page menu bar for Terminay, Edit, View, and Help so shared commands remain discoverable without native application menus. Host capability negotiation SHALL select exactly one application-menu presentation: Desktop SHALL use its native menu and the shared renderer SHALL NOT render the browser menu bar, while browser hosts SHALL render the in-page menu. On macOS, project controls SHALL respect the native title-bar and traffic-light inset and SHALL NOT overlap either native chrome or an in-page menu.

#### Scenario: Desktop workspace menus

- **WHEN** a Desktop workspace renders
- **THEN** it has one native application menu and no in-page Terminay/Edit/View/Help bar

#### Scenario: Browser workspace menus

- **WHEN** a browser workspace renders
- **THEN** it has the in-page menu bar and no native-only commands

#### Scenario: macOS chrome insets

- **WHEN** a macOS workspace renders project controls
- **THEN** they respect the native title-bar and traffic-light inset and overlap neither native chrome nor an in-page menu

### Requirement: Semantic secondary-route presentation

The server-bundled UI SHALL request semantic secondary-route presentation. When its negotiated `nativeWindows` capability is present, Desktop SHALL open Settings, including its Remote Access, Macros, and Extensions categories, as a dedicated native window. Desktop SHALL use modal editing only for tab and project editing. Browser hosts and compatible Desktop shells without that capability SHALL present the same routes in-page with route or editing semantics appropriate to the viewport.

#### Scenario: Desktop with native windows

- **WHEN** the Desktop host negotiates the `nativeWindows` capability
- **THEN** Settings opens as a dedicated native window and only tab and project editing use modals

#### Scenario: Host without native windows

- **WHEN** a browser host or a Desktop shell without that capability requests the same routes
- **THEN** they are presented in-page with route or editing semantics appropriate to the viewport

### Requirement: Native menu bar only on project windows

On Windows and Linux, Terminay Desktop SHALL attach the native application menu bar only to project-host workspace windows. Every other Desktop window SHALL have no native menu bar, including auxiliary Settings, Performance Log, and edit windows, terminal pop-out windows, and transient helper windows. This SHALL hold for the whole life of each window, including after the application menu is rebuilt because settings or keyboard shortcuts changed. A window with no menu bar SHALL still dispatch configured application keyboard shortcuts and the terminal copy accelerator. On macOS, the single global application menu SHALL be unchanged.

#### Scenario: Project window shows the menu bar

- **WHEN** a project-host workspace window opens on Windows or Linux
- **THEN** it shows the native Terminay, Terminal, Edit, View, Window and Help menu bar

#### Scenario: Settings window has no menu bar

- **WHEN** the Settings auxiliary window opens on Windows or Linux
- **THEN** it has no native menu bar

#### Scenario: Other secondary windows have no menu bar

- **WHEN** a Performance Log, edit-tab or terminal pop-out window opens on Windows or Linux
- **THEN** it has no native menu bar

#### Scenario: Menu rebuild does not re-attach the bar

- **WHEN** a keyboard shortcut or other setting changes while a secondary window is open on Windows or Linux, and the application menu is rebuilt
- **THEN** project-host windows show the rebuilt menu bar and the secondary window still has no menu bar

#### Scenario: Shortcuts in a window without a menu bar

- **WHEN** a configured application shortcut or `Ctrl+Shift+C` is pressed in a secondary window on Windows or Linux
- **THEN** the command or terminal copy is dispatched as it is in a project-host window

#### Scenario: macOS global menu

- **WHEN** any Terminay window is focused on macOS
- **THEN** the single global application menu is shown

### Requirement: Server-authoritative file and macro definitions

File-panel diff-layout changes SHALL use the same settings command facade and SHALL remain server-authoritative across the shared UI hosts. File-extension defaults saved in Settings SHALL be observed by already-mounted Desktop and browser workspaces through that same selected-server client, and the file panel SHALL NOT consult a separate browser-local settings snapshot. Macro definitions and categories SHALL require an explicitly supplied selected-server client; there SHALL be no ambient macro compatibility context or preload-shaped fallback. The macro settings client SHALL expose macro definitions and categories only, and no host SHALL offer it a secret action.

#### Scenario: File-extension default changed

- **WHEN** a file-extension default is saved in Settings
- **THEN** already-mounted Desktop and browser workspaces observe it through the selected-server client

#### Scenario: Macro settings client surface

- **WHEN** the Macros category of Settings is given its selected-server client on any host
- **THEN** the client reads, replaces, resets, and observes macro definitions and categories, and exposes no operation that reads, saves, or deletes a secret

### Requirement: Web route parity for menu and editing actions

Web menu actions and tab or project double-click or long-press editing SHALL open the in-page Settings or edit-tab route, or select Home's Recordings section, instead of doing nothing when native windows are unavailable.

#### Scenario: Editing a tab on web

- **WHEN** a user double-clicks or long-presses a tab or project on the web host
- **THEN** the in-page edit-tab route opens

#### Scenario: Web menu action without native windows

- **WHEN** a web menu action targets Settings or one of its categories
- **THEN** the in-page Settings route opens at that category rather than no-oping

### Requirement: Settings and Extensions surfaces select a server

The Settings surface SHALL carry a server selector listing every attached connection. It SHALL default to the server that owns the active project tab. Every server-scoped category SHALL present the data of exactly the selected server: settings, secrets, the extension inventory, macros, and the sharing of that server under Remote Access. Values from two servers SHALL NEVER be merged, summed, or shown as one list, and a change SHALL be committed only on the selected server. The saved servers listed under Remote Access belong to the host, not to a server, and SHALL NOT change with the selector. Selecting a connection that is unavailable or incompatible SHALL show that connection's state instead of its server-scoped categories.

#### Scenario: Default selection

- **WHEN** the user opens Settings while a project of an attached server is active
- **THEN** the server selector starts on that server and shows its settings

#### Scenario: Switching servers

- **WHEN** the user selects another attached connection
- **THEN** the surface shows only that server's settings, extensions, macros, and sharing, and no value from the previous server remains visible

#### Scenario: Saved servers do not follow the selector

- **WHEN** the user switches the server selector while Remote Access is shown
- **THEN** the sharing section changes to the newly selected server and the saved-server list stays the same

#### Scenario: Editing applies to one server

- **WHEN** the user changes a setting while a server is selected
- **THEN** the change is committed on that server alone and no other attached server's settings change

#### Scenario: Selected connection is unavailable

- **WHEN** the selected connection is offline or incompatible
- **THEN** the surface reports that connection's state and sends it no settings operation
