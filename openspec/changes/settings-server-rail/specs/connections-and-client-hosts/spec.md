## MODIFIED Requirements

### Requirement: Remote Access in Settings

Settings SHALL be the single management surface for a server's exposure and
for the saved servers this host connects to. A server's exposure SHALL be its
**Remote Access** category, a page under that server's place. The saved
servers SHALL be the **Servers** category under this device, a collection that
lists every server the host remembers, each with its status, and carries **Add
server…** in its list column header.

The exposure page SHALL show, from top to bottom: a status header with
**Expose this server…** or **Stop exposure** and, while exposed, **Create
pairing link**; pending approvals; trusted devices; live connections; the
exposure options (expose on startup, PIN attempt limits, WebRTC domain, and ICE
servers); and **Reset server identity…**. Each trusted device SHALL be named by
its device and browser, with its full user agent available on request, and
SHALL offer **Revoke**.

A saved server's detail SHALL show its name, status, and address, with
**Rename**, **Forget**, and a retry action while it is offline. **Add server…**
SHALL show the add-connection form in the detail pane.

Desktop SHALL present these categories inside its Settings window and the
browser host inside its in-page Settings route. No other window SHALL manage
pairing, approvals, trusted devices, live connections, server identity, or
saved servers.

#### Scenario: Remote Access opens the server's exposure

- **WHEN** the user invokes Remote Access from the Command Bar or a pending-approval notification
- **THEN** Settings opens, or is focused, at Remote Access of the server the command concerns

#### Scenario: Managing connections opens the saved servers

- **WHEN** the user uses the connection menu's manage control
- **THEN** Settings opens, or is focused, at This device › Servers

#### Scenario: Empty saved-server list

- **WHEN** there are no saved servers
- **THEN** This Mac › Servers shows a quiet note in its list column and Add server… in its header

#### Scenario: Exposure options live with exposure

- **WHEN** the user needs to change the WebRTC domain or ICE servers
- **THEN** they are edited on the server's Remote Access page, beside the trusted devices and live connections

#### Scenario: Readable trusted devices

- **WHEN** an iPhone running Safari is a trusted device
- **THEN** it is listed by its device and browser rather than by its raw user agent, and the full user agent can be revealed

#### Scenario: Adding a server

- **WHEN** the user chooses Add server…
- **THEN** the add-connection form appears in the detail pane and the list column stays visible
