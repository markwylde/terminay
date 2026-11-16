## MODIFIED Requirements

### Requirement: Distinct connection management actions

Rename SHALL change only remote display metadata. Archive SHALL hide a remote profile without deleting its saved origin. Forget SHALL remove host-local metadata and credentials only after confirmation. Revoke SHALL change server authorization and close affected connections, only after separate confirmation. Forget and revoke SHALL require confirmation explaining their different scopes, and forgetting a profile SHALL NOT claim to revoke server access. Each confirmation SHALL name the server it acts on. None of these actions SHALL rename, archive, forget, or revoke the immutable Local profile.

#### Scenario: Local profile is immutable

- **WHEN** the user attempts to rename, archive, forget, or revoke Local
- **THEN** the action is not available

#### Scenario: Forget and revoke have distinct copy

- **WHEN** the user chooses forget or revoke
- **THEN** confirmation copy explains that forget removes host-local metadata and revoke closes server-side access

#### Scenario: Confirmation names the server

- **WHEN** the user chooses forget for a saved server named popos
- **THEN** the confirmation asks "Forget popos?"

## ADDED Requirements

### Requirement: Saved server status in Remote Access settings

Settings › Remote Access SHALL show, for each saved server, whether this window holds a connection to it. An attached server SHALL show its connection state. A server that is not attached SHALL say it is saved and not attached, without claiming whether the server is up.

#### Scenario: Attached and unattached servers are told apart

- **WHEN** Remote Access lists one saved server this window is connected to and one it is not attached to
- **THEN** the first shows "Connected · attached" and the second shows "Saved · not attached"

### Requirement: Saved server danger zone in Remote Access settings

A saved server's detail SHALL show a **Connection** block with its status and non-destructive actions, then a visually distinct **Danger zone** block holding **Forget** and, where offered, **Revoke access**, each describing its scope. Choosing either SHALL replace its row with an inline confirmation inside the danger zone, offering **Cancel** first and focused, then a destructive confirm button.

#### Scenario: Forget is confirmed in the danger zone

- **WHEN** the user chooses Forget on a saved server's detail
- **THEN** a confirmation naming the server appears inside the Danger zone, below and clear of the Connection block, with Cancel focused
