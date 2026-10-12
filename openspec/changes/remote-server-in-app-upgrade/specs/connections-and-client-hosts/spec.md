## ADDED Requirements

### Requirement: Server upgrade indication in the header and connection menu

The header connections control SHALL show a warning icon beside the server label while the active tab's server reports an upgrade available, and SHALL add that fact and the available version to the control's accessible name. The icon SHALL describe the active tab's server only. The connection menu SHALL mark every attached server that reports an upgrade available with its available version, and SHALL offer **Upgrade server…** on each one whose status says the server can carry out the upgrade. For a server that cannot, the menu SHALL show the reason and the command its status gives, with a copy action, and no upgrade action. The indication SHALL be the same on Desktop, browser, and phone-width hosts, and SHALL never appear for **Local**.

#### Scenario: Active server has an upgrade

- **WHEN** the active tab's server reports version `5.2.0` available
- **THEN** the header control shows the warning icon and its accessible name states that an upgrade to `5.2.0` is available

#### Scenario: Another attached server has an upgrade

- **WHEN** an attached server that is not the active tab's reports an upgrade
- **THEN** the header shows no warning icon, and that server's row in the connection menu is marked and offers **Upgrade server…**

#### Scenario: Server cannot upgrade itself

- **WHEN** an attached server reports an upgrade it cannot carry out
- **THEN** its menu row shows the reason and a copyable command, and no **Upgrade server…** action

#### Scenario: Local

- **WHEN** the active tab's server is **Local**
- **THEN** no server upgrade icon or action is shown; the Desktop update action is unaffected

### Requirement: Confirming and following a server upgrade

Choosing **Upgrade server…** SHALL open a confirmation in the host's in-page window frame that names the server, its running version, and the available version, and states that the connection to that server drops briefly and that its terminals keep running. When the server offers the recreate mode, the confirmation SHALL offer both modes with in-place preselected, and SHALL state beside recreate that it ends every terminal on that server. Nothing SHALL be sent to the server until the user confirms.

While the upgrade is in progress the menu row SHALL say so, the upgrade action SHALL be unavailable on every client attached to that server, and the connection's drop and return SHALL use the ordinary reconnecting presentation. When the server's status reports the outcome, the client SHALL show it once: the new version on success, or the failure reason and the restored version on failure. A client that sees no status from that server within the reconnect deadline SHALL report that the server did not come back and SHALL keep its ordinary offline presentation.

#### Scenario: Confirmation names the versions

- **WHEN** the user chooses **Upgrade server…** on a server running `5.1.1` with `5.2.0` available
- **THEN** the confirmation names both versions and the brief disconnect, and no request has been sent

#### Scenario: Container with the socket

- **WHEN** the server offers both modes
- **THEN** the confirmation offers in-place, preselected, and recreate with a statement that recreate ends every terminal

#### Scenario: Cancel

- **WHEN** the user dismisses the confirmation
- **THEN** no request is sent and the server's status is unchanged

#### Scenario: Progress on another device

- **WHEN** one device starts an upgrade while a second is attached to the same server
- **THEN** the second device's menu row shows the upgrade in progress and offers no upgrade action

#### Scenario: Success

- **WHEN** the connection returns and the status reports the completed move
- **THEN** the warning icon is gone and the user is told the server is now on `5.2.0`

#### Scenario: Rolled back

- **WHEN** the connection returns and the status reports a rollback
- **THEN** the user is told the upgrade failed, why, and that `5.1.1` is running again, and the warning icon remains
