## ADDED Requirements

### Requirement: Check for updates on each attached server

The connection menu, in the wide header and the compact switcher, SHALL show a row for every attached server whose status names a channel, whether or not an upgrade is on offer. The row SHALL say the version the server runs and SHALL offer **Check for updates** unless an upgrade is in progress. The action SHALL be disabled while the connection is down or a check it started is running. When the check ends, the row SHALL say "Up to date · <version>", "Update available · <version>" with **Upgrade server…**, or why it could not check: the channel could not be read, the server is not connected, or the server predates the request. A server's Updates page in Settings SHALL offer the same action under its release track, with the same result line. Local SHALL NOT be offered the action; it is updated with Terminay Desktop.

#### Scenario: Nothing on offer yet

- **WHEN** a remote server on Canary reports no upgrade and the person opens the connection menu
- **THEN** its row says the version it runs and offers **Check for updates**

#### Scenario: The check finds a newer build

- **WHEN** the person chooses **Check for updates** and the server finds a newer build
- **THEN** the row says "Update available · <version>" and offers **Upgrade server…**, and the header shows the upgrade warning

#### Scenario: From Settings

- **WHEN** the person chooses **Check for updates** on a server's Updates page
- **THEN** the button reads "Checking…" until the server replies, and the page then shows the latest release and what the check found

#### Scenario: A server that predates the request

- **WHEN** the server rejects `server.upgrade.check` as an unknown operation
- **THEN** the row says the server is too old to check on request and checks by itself every hour
