## MODIFIED Requirements

### Requirement: Confirming and following a server upgrade

Choosing **Upgrade server…** SHALL open a confirmation in the host's in-page window frame. The confirmation names the server, its running version, and the available version, and says the connection drops briefly while terminals keep running. When the server offers the recreate mode, the confirmation SHALL offer both modes with in-place preselected, and SHALL say beside recreate that it ends every terminal on that server. Nothing SHALL be sent until the user confirms. While the request is outstanding the confirmation SHALL show that it is starting. A refusal SHALL stay in the confirmation with its reason, and no progress SHALL be shown for it.

Once the server accepts, or the reply is lost to the server's restart, a progress card SHALL replace the confirmation. The card is titled with the server's name and lists the steps in order: **Starting the upgrade**, **Installing** the target version, **Restarting** the server (**Recreating the container** in the recreate mode), and **Running** the target version. Each step SHALL show waiting, running, done, or failed. Until the upgrade ends exactly one step SHALL be running; once it ends none SHALL be. The client SHALL NOT poll for the steps. The card SHALL be drawn centred over the whole window, SHALL be modal while shown, SHALL NOT move when the connection drops or returns, and SHALL be exposed to assistive technology as a status region. The card SHALL be held by the window rather than by one connection's workspace.

While the window's connection is down during a followed upgrade, the client SHALL show **Restarting** running. The card SHALL stand in place of the reconnecting overlay's stall or connection-lost text, and the connection's status SHALL read "Restarting for upgrade…" rather than "Reconnecting…". While an upgrade is in progress, the server's menu row SHALL name the running step on every attached client, and the upgrade action SHALL be unavailable on all of them. The card SHALL offer nothing to dismiss it before the upgrade ends. On the device that started the upgrade, the card SHALL keep its final state until the user closes it; on any other device it SHALL be removed when the upgrade ends. The client SHALL tell each ending once as an entry in the header Notifications list, kept until dismissed, and SHALL NOT open a popup over the workspace on a device whose card is not already showing.

#### Scenario: Confirmation names the versions

- **WHEN** the user chooses **Upgrade server…** on a server running `5.1.1` with `5.2.0` available
- **THEN** the confirmation names both versions and the brief disconnect, and no request has been sent

#### Scenario: Container with the socket

- **WHEN** the server offers both modes
- **THEN** the confirmation offers in-place, preselected, and recreate with a statement that recreate ends every terminal

#### Scenario: Cancel

- **WHEN** the user dismisses the confirmation
- **THEN** no request is sent and the server's status is unchanged

#### Scenario: Refused

- **WHEN** the user confirms and the server refuses because an upgrade is already running
- **THEN** the confirmation stays open with that reason and no progress card is shown

#### Scenario: Recreate wording

- **WHEN** the user confirms the recreate mode
- **THEN** the card's third step reads **Recreating the container**

#### Scenario: The restart is a step, not an error

- **WHEN** the server restarts during a followed upgrade and the connection drops
- **THEN** the same card, in the same place, shows **Restarting** running, no stall or connection-lost text is shown, and the connection's status reads "Restarting for upgrade…"

#### Scenario: Card survives the reconnect

- **WHEN** the connection returns and the workspace is replaced on the new connection
- **THEN** the same progress card is still shown

#### Scenario: Nothing beneath the card is usable

- **WHEN** the card is shown while the upgrade runs
- **THEN** the workspace beneath it cannot be used and the card offers no way to dismiss it

#### Scenario: Closing the finished card

- **WHEN** the upgrade has ended and the user closes the card on the device that started it
- **THEN** the card is gone and the Notifications entry remains until dismissed

## ADDED Requirements

### Requirement: The progress card follows one attempt by id

Against a server advertising `server.upgrade.attempts`, a device SHALL follow an upgrade as that server's attempt, identified by its attempt id. The device that starts it SHALL choose a request id, remember it with the target and mode before sending, and send it with the start. It SHALL follow the attempt carrying that request id, whether or not the start reply arrives. Any other device SHALL follow a pending attempt it reads from the server. A device that reloads its document SHALL follow the same attempt.

#### Scenario: Reply lost to the restart

- **WHEN** the phone sends a start with request id `r1` and the connection drops before the reply arrives
- **THEN** on reconnect the phone follows the attempt carrying `r1`, at whatever stage or ending it has reached

#### Scenario: Reopened during the attempt

- **WHEN** the phone's app is closed and reopened while the attempt is at stage `finishing`
- **THEN** the card is shown for the same attempt with **Running** running

#### Scenario: Ended before the reply

- **WHEN** the attempt has already ended by the time the start reply is handled
- **THEN** the card shows that ending and is not reopened as pending

### Requirement: The card's steps come from the attempt

A followed attempt's steps SHALL come from its stage and the connection's phase:

- `requested`: **Starting the upgrade** running;
- `installing`: **Installing** running;
- connection down: **Restarting** running;
- `finishing`: **Running** running.

#### Scenario: Confirming shows the first step

- **WHEN** the user confirms and the server accepts at stage `requested`
- **THEN** the card lists **Starting the upgrade** running, and **Installing 5.2.0**, **Restarting**, and **Running 5.2.0** waiting

#### Scenario: Helper starts

- **WHEN** the attempt moves to `installing`
- **THEN** **Starting the upgrade** is done and **Installing 5.2.0** is running

### Requirement: A followed attempt ends on its own ending

A followed attempt SHALL end on the attempt's own ending, as the server reports it:

- succeeded: every step done;
- unchanged: every step done, saying the server was already on that release;
- rolled back: **Running** failed with the reason and the restored release;
- failed: the step the attempt was in failed, with the reason.

The connection-level endings SHALL also end it:

- no attempt arrives within the reconnect deadline, or the connection layer stops trying: **Restarting** failed, saying the server did not come back. A later return SHALL NOT reopen the card;
- the server returns as one this client cannot speak to: **Running** failed with the connection's explanation.

An ending of another attempt SHALL NOT end a followed attempt. The client SHALL NOT decide an ending from the version the server runs or from times. Each ending SHALL be told once in the Notifications list.

#### Scenario: Already current

- **WHEN** a phone confirms an upgrade and the server's helper finds nothing to install
- **THEN** the card ends with every step done, saying the server was already on that release, without waiting for any deadline

#### Scenario: Success

- **WHEN** the attempt ends as succeeded on `5.2.0`
- **THEN** every step is done, the warning icon is gone, and the Notifications list holds one entry saying the server is now on `5.2.0`

#### Scenario: Rolled back

- **WHEN** the attempt ends as rolled back
- **THEN** the card marks **Running 5.2.0** failed with the reason and says `5.1.1` is running again

#### Scenario: Helper never starts

- **WHEN** the attempt ends as failed because the upgrader did not start
- **THEN** **Starting the upgrade** is failed with the reason and the command to run

#### Scenario: Server does not come back

- **WHEN** no attempt arrives from the server within the reconnect deadline
- **THEN** **Restarting** is failed, saying the server did not come back, the Notifications list holds one entry, and the window keeps its ordinary offline presentation

#### Scenario: Back as an incompatible server

- **WHEN** the connection returns and the server is one this client cannot speak to
- **THEN** **Running 5.2.0** is failed with the explanation of which side needs updating

### Requirement: Following an upgrade on a server without attempts

Against a server that does not advertise `server.upgrade.attempts`, a device SHALL follow the upgrade from the start reply and the status's in-progress state. It SHALL end it on the first of these:

- the status reports success, or the server returns running the target version: every step done;
- the status reports a rollback: **Running** failed with the reason;
- the server returns running the version it ran before, without an outcome stamped after the start: **Running** failed, saying it is still on that version;
- the server returns and says nothing of its upgrade before the reconnect deadline: **Running** failed;
- the connection-level endings above.

Every state SHALL reach an ending within the reconnect deadline once the server has returned. When a followed attempt's server returns without advertising `server.upgrade.attempts`, these rules SHALL apply from then on.

#### Scenario: Server without attempts upgrades

- **WHEN** a device upgrades a server that does not advertise `server.upgrade.attempts` from `5.1.1` to `5.2.0`, and it returns running `5.2.0`
- **THEN** every step is done

#### Scenario: Installed back to a server without attempts

- **WHEN** a followed install-latest attempt moves the server to a release that does not advertise `server.upgrade.attempts`, and it returns running that release
- **THEN** the card ends by these rules and does not wait for an attempt id
