## ADDED Requirements

### Requirement: Disconnect and detach

**Disconnect** SHALL close a connection's client transport and SHALL NOT stop the server or terminate its PTYs. **Detach** SHALL remove a server from the window's composition, dropping its tabs from the strip and closing its transport, and SHALL close nothing on the server itself. On `app.terminay.com`, **Terminay → Disconnect** and **Switch connections** SHALL close the primary connection and return to the manager connection list, using `shell.back` when framed. Desktop SHALL have no Disconnect item in any menu. Closing or reloading the host SHALL preserve server-side sessions.

#### Scenario: Disconnect leaves PTYs running

- **WHEN** a browser user disconnects
- **THEN** the client transport closes while the server and its PTYs continue

#### Scenario: Desktop has no Disconnect

- **WHEN** a Desktop user opens the Terminay menu
- **THEN** there is no Disconnect item

#### Scenario: Detach removes tabs without touching the server

- **WHEN** the user detaches an attached server
- **THEN** its tabs leave the composition and its terminals, projects, and PTYs on that server are untouched

### Requirement: Remote Access in Settings

The **Remote Access** category of Settings SHALL be the single management surface for this server's exposure and for the saved servers this host connects to. Its list column SHALL show two section labels. Under **This server**, one item SHALL stand for the exposure of the server chosen in the Settings server selector, named after that server and showing its exposure state and trusted-device count. Under **Saved servers**, SHALL be every server the host remembers, each with its status. **Add server…** SHALL sit in the list column header.

The exposure detail SHALL show, from top to bottom: a status header with **Expose this server…** or **Stop exposure** and, while exposed, **Create pairing link**; pending approvals; trusted devices; live connections; the exposure options (expose on startup, PIN attempt limits, WebRTC domain, and ICE servers); and **Reset server identity…**. Each trusted device SHALL be named by its device and browser, with its full user agent available on request, and SHALL offer **Revoke**.

A saved server's detail SHALL show its name, status, and address, with **Rename**, **Forget**, and a retry action while it is offline. **Add server…** SHALL show the add-connection form in the detail pane.

Desktop SHALL present this category inside its Settings window and the browser host inside its in-page Settings route. No other window SHALL manage pairing, approvals, trusted devices, live connections, server identity, or saved servers.

#### Scenario: Both entry points open the same surface

- **WHEN** the user invokes Remote Access from the Command Bar or uses the connection menu's manage control
- **THEN** Settings opens, or is focused, at Remote Access

#### Scenario: Empty saved-server list

- **WHEN** there are no saved servers
- **THEN** the list column shows this server's exposure item, a quiet note under Saved servers, and Add server… in its header, and the detail pane shows exposure

#### Scenario: Exposure options live with exposure

- **WHEN** the user needs to change the WebRTC domain or ICE servers
- **THEN** they are edited in the exposure detail of Remote Access, beside the trusted devices and live connections

#### Scenario: Readable trusted devices

- **WHEN** an iPhone running Safari is a trusted device
- **THEN** it is listed by its device and browser rather than by its raw user agent, and the full user agent can be revealed

#### Scenario: Adding a server

- **WHEN** the user chooses Add server…
- **THEN** the add-connection form appears in the detail pane and the list column stays visible

## REMOVED Requirements

### Requirement: Disconnect semantics

**Reason**: The requirement named the File menu, which no host has.
**Migration**: Same behaviour, restated in "Disconnect and detach" with Disconnect in the Terminay menu.

### Requirement: Remote Control management surface

**Reason**: Remote Control is no longer a window of its own; its content is the Remote Access category of Settings.
**Migration**: Use Settings › Remote Access, opened from the Command Bar, its accelerator, or the connection menu manage control.

### Requirement: File menu grouping

**Reason**: There is no File menu. Workspace creation and Settings live in the Terminay menu, and the management surfaces it grouped are categories of Settings or a Home section.
**Migration**: New Terminal Tab, New Project, and Settings… are in the Terminay menu (see `settings-shortcuts-and-desktop-integration`, "Terminay application menu"). Remote Access, Macros, and Extensions are Settings categories, and Recordings is a Home section.

## MODIFIED Requirements

### Requirement: Connection menu contents

The connection menu SHALL list every attached connection with its label and status — connected, offline, reconnecting, unauthenticated, degraded, or incompatible — and SHALL offer **Attach** for a remembered connection that is not attached and **Detach** for one that is. On Desktop it SHALL list every remembered connection as a single line with **Local** first, where **Local** is always the attached primary. On a framed `app.terminay.com` session it SHALL list the framed primary and its attached connections, and SHALL NOT be a switcher for the manager's other saved profiles, because the manager owns the saved-profile list outside the iframe. The menu SHALL contain a manage control on the Connections heading that opens Settings at **Remote Access**; **Expose this server…** for a chosen attached server when the current device is allowed to manage that server's exposure; **Create pairing link** while that server is exposed; live **Active Connections** per attached server for every connected browser or Desktop peer, with empty copy using the same inset as other menu rows; retry and forget or revoke actions with distinct language inside Settings › Remote Access; and **Switch connections** only when the browser session can return to the `app.terminay.com` manager.

#### Scenario: Desktop menu lists remembered profiles

- **WHEN** a Desktop user opens the connection menu
- **THEN** every remembered connection is listed with **Local** first, each showing its attach state and status, and **Switch connections** is absent

#### Scenario: Framed menu shows only the current connection

- **WHEN** a framed `app.terminay.com` workspace opens its connection menu
- **THEN** it shows the framed primary with its attached connections and **Switch connections**, and not the manager's other saved profiles

#### Scenario: Exposure actions are capability-gated

- **WHEN** the current device is not allowed to manage exposure on the chosen attached server
- **THEN** **Expose this server…** is not offered for that server

#### Scenario: Attaching and detaching a server

- **WHEN** the user chooses **Attach** on a remembered connection and later **Detach** on it
- **THEN** that server's tabs join the window's composition and later leave it, and nothing on that server is stopped

### Requirement: Pair Device dialog

**Create pairing link** from the connection menu and from Settings › Remote Access SHALL open the same Pair Device dialog. The exposure header in Remote Access SHALL show that action next to **Stop exposure** while the server is exposed. The dialog SHALL show the one-time pairing link and a copy control, and SHALL NOT show the session-origin hostname. When a device requests enrollment, the dialog SHALL replace the QR with that device's name and match code and **Approve** and **Deny**, and SHALL restore a fresh QR after the decision. The pairing URL field SHALL stack at full width above continue and cancel actions.

#### Scenario: Dialog hides the session hostname

- **WHEN** the Pair Device dialog is open
- **THEN** it shows the one-time pairing link and copy control and not the session-origin hostname

#### Scenario: Same dialog from both entry points

- **WHEN** **Create pairing link** is chosen from the connection menu or from Settings › Remote Access
- **THEN** the same Pair Device dialog opens

#### Scenario: Request appears in place of the QR

- **WHEN** a device submits an enrollment request while the dialog shows the QR
- **THEN** the QR is replaced by the device name, match code, and Approve and Deny controls

### Requirement: Pending approval surface

While a device awaits approval, the exposure detail in Settings › Remote Access, the Pair Device dialog, and the standalone CLI SHALL show the requested device name and the five-character match code with **Approve** and **Deny**. Desktop SHALL also raise a native notification naming the device so the administrator notices a request made while the dialog is closed. Approve and Deny SHALL act only on the exact pending request they were rendered for; a request that expired or was replaced SHALL show as such rather than approving a different one.

#### Scenario: Approval from the notification

- **WHEN** the administrator activates the pending-approval notification
- **THEN** Settings opens at Remote Access on the pending request with its match code and controls

#### Scenario: Stale approval is inert

- **WHEN** the administrator approves a request that has already expired
- **THEN** nothing is enrolled and the surface reports the request expired

### Requirement: Shared management routes across hosts

Settings, including its Remote Access, Macros, and Extensions categories, Home's Recordings section, and the edit-tab surfaces SHALL use shared routes and components. Electron SHALL present Settings as a first-class native window, while edit-tab routes MAY use modal project-editor chrome. The web host SHALL present the same routes in-page with equivalent open, focus, save, cancel, and close semantics.

#### Scenario: Web presents the same routes in-page

- **WHEN** a web user opens Settings at Remote Access
- **THEN** the same route is presented in-page with equivalent open, focus, save, cancel, and close semantics

### Requirement: Application menu per host

Browser hosts SHALL expose an in-page application menu for the shared workspace containing Terminay, Edit, View, and Help menus with the same command vocabulary as the Desktop native menu wherever the browser has an equivalent capability. On a wide workspace that menu SHALL present as a menu bar band above the workspace. On a compact workspace at 640px and below it SHALL present as a single menu control inside the workspace chrome row, opening one menu whose Terminay, Edit, View, and Help commands stay grouped and labelled by their menu, so the same commands remain reachable without a band of its own. Native-only entries such as OS window management, Desktop update installation, native file dialogs, and DevTools SHALL remain absent or disabled unless the host capability exists. Desktop hosts SHALL advertise native menus and therefore omit the in-page application menu entirely, at every width. macOS native title-bar insets SHALL keep traffic lights separate from project tabs and workspace controls.

#### Scenario: Desktop omits the in-page menu

- **WHEN** a Desktop host renders the workspace
- **THEN** the in-page application menu bar is absent

#### Scenario: Native-only entries are hidden in the browser

- **WHEN** a browser host renders the application menu
- **THEN** OS window management, Desktop update installation, native file dialogs, and DevTools entries are absent or disabled

#### Scenario: Compact browser workspace collapses the band

- **WHEN** a browser host renders the workspace at 640px or narrower
- **THEN** no application menu band is rendered and a single menu control sits in the workspace chrome row

#### Scenario: Compact menu keeps every command

- **WHEN** the compact application menu control is opened
- **THEN** it presents the Terminay, Edit, View, and Help commands grouped and labelled by their menu, with the same capability gating as the wide menu bar

