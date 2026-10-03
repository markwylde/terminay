## ADDED Requirements

### Requirement: Service restarts and upgrades keep terminal sessions

Stopping, restarting, or upgrading the service SHALL NOT end terminal sessions. The service unit SHALL be written so that stopping the server process leaves the session holder and its shells running. `daemon upgrade` and a rollback after a failed upgrade SHALL each leave every session that was running before the command running and reattached afterwards. A stopped service's sessions SHALL end when the server's unattached limit passes.

#### Scenario: Upgrade with running sessions

- **WHEN** `daemon upgrade` succeeds on a server with running terminal sessions
- **THEN** those sessions are running and attached to the upgraded server

#### Scenario: Rollback with running sessions

- **WHEN** an upgrade fails readiness and rolls back
- **THEN** the sessions that were running before the upgrade are running and attached to the previous version

#### Scenario: Service restarted

- **WHEN** the service is restarted by the service manager
- **THEN** no terminal session ends

#### Scenario: Service stopped and left stopped

- **WHEN** the service is stopped and not started again within the unattached limit
- **THEN** its terminal sessions end and no session holder remains

### Requirement: Uninstall ends terminal sessions

`daemon uninstall` SHALL end every terminal session of the server and leave no session holder running before it removes the installation.

#### Scenario: Uninstall with running sessions

- **WHEN** `daemon uninstall` runs on a server with running terminal sessions
- **THEN** every session ends and no session holder process remains
