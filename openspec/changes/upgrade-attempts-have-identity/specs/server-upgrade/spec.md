## ADDED Requirements

### Requirement: An upgrade attempt has an identity the server owns

Every accepted upgrade or install-latest request SHALL create one attempt. The attempt SHALL have a server-chosen id, the request id the device sent (if any), the mode, the start time, an expiry thirty minutes after the start, and the version and revision of the release it starts from. The server SHALL persist the attempt in its data root before handing it over, and SHALL keep it after it ends as the last attempt until the next one replaces it. A server that starts and finds a persisted attempt SHALL take it up and report it. Only one attempt SHALL be pending per install.

#### Scenario: Start publishes the attempt before replying

- **WHEN** a device sends a start with request id `r1` and the server accepts it
- **THEN** before the reply, the server publishes an attempt carrying a new attempt id, request id `r1`, and stage `requested`, and the reply keeps the upgrade status's shape

#### Scenario: Attempt survives the restart

- **WHEN** the upgrader restarts the server on the new release before recording its ending
- **THEN** the new server publishes the same attempt, pending, and offers no upgrade

#### Scenario: Outcome survives a second restart

- **WHEN** an attempt ended in success and the server restarts again before a phone reconnects
- **THEN** the phone reads the same attempt id with its success

### Requirement: The attempt reports its stage

While an attempt is pending, the server SHALL report its stage:

- `requested`: no upgrader run is bound to it yet;
- `installing`: a run is bound, and this is the server that handed the attempt over;
- `finishing`: a run is bound, and this server was started while the attempt was pending.

#### Scenario: Helper picks the request up

- **WHEN** the helper's run records its start after the attempt began
- **THEN** the attempt moves from `requested` to `installing`

#### Scenario: Restarted before the helper started

- **WHEN** the server restarts for an unrelated reason while its attempt is `requested`
- **THEN** the new server reports the attempt as `requested`, not `finishing`

### Requirement: An attempt ends on its own run's record

While an attempt is pending, the server SHALL watch the install's upgrade record and SHALL NOT poll it. The first run whose start record is stamped at or after the attempt's start SHALL be bound to the attempt. Only an ending from the bound run SHALL end the attempt, whichever server reads it. The attempt SHALL take the ending's kind: succeeded, rolled back, unchanged, or failed with nothing changed. The server SHALL refuse a new attempt while the record shows a run that started within the last thirty minutes and has not ended.

#### Scenario: Nothing to install

- **WHEN** a system-scope server hands an attempt to the helper and the helper finds the build is already installed
- **THEN** within seconds of the helper exiting, the attempt ends as unchanged, naming the running release

#### Scenario: A second run's record

- **WHEN** an attempt is bound to run `a`, and a different run `b` records an ending
- **THEN** the attempt does not end

#### Scenario: A manual upgrade is running

- **WHEN** a device asks for an upgrade while an operator's `daemon upgrade` has recorded a start and no ending
- **THEN** the server refuses, saying an upgrade is already running on the host

### Requirement: Every attempt reaches an ending by its deadlines

Each attempt SHALL be bounded by deadlines measured from its start, and a server restart SHALL NOT extend them:

- an attempt with no bound run two minutes after its start SHALL end as failed, saying the upgrader did not start and naming the command to run on the host;
- an attempt still pending at its expiry SHALL end as failed, saying the upgrader did not report how it ended and naming the release the server now runs.

The server SHALL NOT end an attempt as succeeded without the bound run's success. After every ending, the server SHALL check its channel again. Where the host sees a spawned upgrader exit while the server still runs, the server SHALL read the record once more, and SHALL end the attempt as failed if the bound run has not recorded an ending.

#### Scenario: Helper never starts

- **WHEN** the helper's path unit is inactive and no run records a start within two minutes of the attempt's start
- **THEN** the attempt ends as failed, saying the upgrader did not start and naming the command to run

#### Scenario: Repeated restarts

- **WHEN** the server restarts several times while an attempt is pending and no ending is recorded
- **THEN** the attempt still ends at the expiry set when it started

#### Scenario: New release running but no record

- **WHEN** an attempt's expiry passes while the server runs a revision other than the one the attempt started from, and the bound run recorded no ending
- **THEN** the attempt ends as failed, saying how it ended is unknown and naming the release now running

### Requirement: Attempts are published on their own surface

A server SHALL advertise `server.upgrade.attempts` in its hello and SHALL publish the last attempt (or none) through the `server.upgrade.attempt` query, and an event on every change. A start request MAY carry a request id only to a server advertising `server.upgrade.attempts`. The upgrade status SHALL keep its shape. While an attempt is pending, the status SHALL report it as in progress. An ended attempt SHALL be reported as the status's outcome, named by its versions: unchanged as succeeded from and to the same release, and failed with nothing changed as failed with the release running again.

#### Scenario: A released client reads the status

- **WHEN** a client that predates attempts reads the status of a server with a pending attempt
- **THEN** the status parses and reports the upgrade in progress

#### Scenario: An attempt-aware client

- **WHEN** a client that knows attempts attaches to a server advertising `server.upgrade.attempts`
- **THEN** it reads the attempt with its id, request id, stage, and ending

### Requirement: Builds are compared by revision

The server SHALL compare releases by source revision wherever the build matters, and SHALL NOT treat equal version strings as the same build. It SHALL NOT offer the revision its own process runs. While its install record names a revision other than its own, it SHALL offer nothing from that record, SHALL watch for the record to be rewritten, and SHALL check again when it is. That includes on attach, regardless of how recent the last check was. The release check SHALL report the revision of an available or latest rolling build with its version.

#### Scenario: Restarted before the record is rewritten

- **WHEN** a server restarts on Canary revision `b2fd47fb` with no attempt pending, and its install record still names `b2a60196`
- **THEN** its status offers no upgrade, and within seconds of the record naming `b2fd47fb` it reports what the channel holds against that

#### Scenario: Same version string, different build

- **WHEN** a Canary server on `6.10.0-main.3493.canary` at revision `b2a60196` checks, and the channel's build is `6.10.0-main.3493.canary` at revision `b2fd47fb`
- **THEN** the status offers that build as available

#### Scenario: Channel holds the running build

- **WHEN** the channel's newest build is the revision the server runs
- **THEN** no upgrade is available, whatever the install record's publish time says
