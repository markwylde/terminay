## ADDED Requirements

### Requirement: A server checks a surviving session holder's health on attach

Each time a server attaches to a session holder it did not launch, it SHALL check the holder's environment in addition to its build. On Linux, a holder SHALL be healthy only when it shares the server's mount namespace and both `/tmp` and the holder's `TMPDIR` exist and are writable from the holder's view of the filesystem. When the server cannot determine the result, the holder SHALL be treated as not healthy, and the reason SHALL be recorded in diagnostics.

#### Scenario: Holder lost its temporary directory across a restart

- **WHEN** a server starts and `/tmp` no longer exists from the surviving holder's view
- **THEN** the holder is reported unhealthy

#### Scenario: Holder in another mount namespace

- **WHEN** a server starts in a different mount namespace from the surviving holder
- **THEN** the holder is reported unhealthy

#### Scenario: Health cannot be read

- **WHEN** the server cannot read the holder's process information
- **THEN** the holder is reported as not checkable, with the reason, and is treated as not healthy

### Requirement: Only a healthy session holder receives new sessions

A holder that is not healthy SHALL be drained. It SHALL keep serving its existing sessions, SHALL NOT receive a new one, and SHALL exit once its last session ends. A new terminal SHALL start in a holder of the current build that is either healthy or was launched by the running server. When no such holder exists, the server SHALL launch one without asking the user.

#### Scenario: New terminal after an unhealthy restart works

- **WHEN** a user opens a new terminal after a restart that left the previous holder unhealthy, and runs `mkdir /tmp/terminay-probe-$$`
- **THEN** the directory is created

#### Scenario: Live sessions keep running

- **WHEN** a holder with two live sessions is found not healthy
- **THEN** both sessions keep running and accept input

#### Scenario: Healthy holder is reused

- **WHEN** a server of the same build starts and the surviving holder passes the health check
- **THEN** new terminals start in that holder and no second holder is launched

### Requirement: A damaged session is flagged on its panel

A live session SHALL be degraded only when its holder's `/tmp` or `TMPDIR` is missing or unwritable while the server's own probe of those paths passes. Its panel SHALL show a non-blocking banner saying that this terminal's temporary directory is no longer usable and that new terminals are not affected. The health check SHALL NOT end a session; a degraded session ends exactly as any other session does.

#### Scenario: Banner shown on a damaged session

- **WHEN** a client shows a terminal panel whose session is degraded
- **THEN** the panel shows the banner and the shell still accepts input

#### Scenario: Namespace mismatch with a working temporary directory

- **WHEN** a surviving holder is in a different mount namespace but `/tmp` is writable from its view
- **THEN** the holder is drained and none of its sessions shows the banner

#### Scenario: Server's own temporary directory is broken

- **WHEN** `/tmp` is not writable from the server's view either
- **THEN** no session shows the banner, and the server reports the host-wide problem in diagnostics

#### Scenario: Degraded session exits normally

- **WHEN** the shell of a degraded session exits
- **THEN** the session ends like any other, and its panel follows the normal ended-session behaviour

#### Scenario: Healthy sessions show no banner

- **WHEN** a server restarts and every surviving holder passes the health check
- **THEN** no terminal panel shows the banner

### Requirement: Restart survival is proven by using the shell

The release gate for persistent terminal sessions SHALL include a test under a real systemd service manager on the standalone archive. Each scenario SHALL start on a fresh data root. Survival SHALL be proven by shells creating a directory in the literal `/tmp` after restarts. A process that is merely still alive SHALL NOT count as proof.

#### Scenario: Gate across restarts

- **WHEN** the systemd test opens a session, restarts the service twice, and opens a second session
- **THEN** it passes only if both sessions create a directory in `/tmp` after the second restart

#### Scenario: Gate reproducing the incident

- **WHEN** the test gives the installed unit `PrivateTmp=true`, as an older release's installer wrote it, opens a session whose holder is born under that private `/tmp`, and holds the upgrade helper's oneshot active as an older upgrader's readiness wait does
- **THEN** it passes only if the repair is requested after the helper finishes, the unit is repaired with no operator command, the surviving session is flagged degraded and cannot create a directory in `/tmp`, and a new terminal can
