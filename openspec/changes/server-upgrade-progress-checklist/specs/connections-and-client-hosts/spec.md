## MODIFIED Requirements

### Requirement: Confirming and following a server upgrade

Choosing **Upgrade server…** SHALL open a confirmation in the host's in-page window frame that names the server, its running version, and the available version, and states that the connection to that server drops briefly and that its terminals keep running. When the server offers the recreate mode, the confirmation SHALL offer both modes with in-place preselected, and SHALL state beside recreate that it ends every terminal on that server. Nothing SHALL be sent to the server until the user confirms. While the request is outstanding the confirmation SHALL show that it is starting; a refusal SHALL stay in the confirmation with its reason, and no progress SHALL be shown for it.

Once the server accepts, or the reply is lost to the server's restart, the confirmation SHALL be replaced by a progress card for the window's server, titled with the server's name, listing the upgrade's steps in order: **Starting the upgrade**, **Installing** the target version, **Restarting** the server (**Recreating the container** in the recreate mode), and **Running** the target version. Each step SHALL show one of waiting, running, done, or failed. Until the upgrade ends exactly one step SHALL be running; once it ends no step SHALL be running. The steps SHALL be derived from the start reply, the server's published upgrade status, and the connection's phase; the client SHALL NOT poll for them. The card SHALL be drawn in one place, centred over the whole window, and SHALL be modal for the whole time it is shown: nothing else in the window can be used beneath it, and it SHALL NOT move when the connection drops or returns. The card SHALL be exposed to assistive technology as a status region. The card SHALL be held by the window rather than by one connection's workspace, so it survives the workspace being replaced on reconnect. The device that started the upgrade SHALL remember the target version and mode with the upgrade it follows, so that after a document reload the card is shown again, with the same steps, as soon as the connection identifies the server.

Every device that follows an upgrade of its window's server SHALL show the card from the moment it begins following until the upgrade ends: the device that started it from acceptance, and any other device from the server's in-progress status, with **Starting the upgrade** done. While the window's connection is down during that upgrade, the client SHALL present that as the **Restarting** step running: the card SHALL stand in place of the reconnecting overlay's stall or connection-lost text, and the connection's status SHALL read "Restarting for upgrade…" rather than "Reconnecting…". While the upgrade is in progress, the server's menu row SHALL name the running step on every client attached to it, including a server attached to the window that is not its own, and the upgrade action SHALL be unavailable on every such client.

The upgrade SHALL end on the first of these, and the card SHALL show it:

- the status reports success, or the server returns running the target version: every step done;
- the status reports a rollback: **Running** failed, with the reason and the restored version;
- the server returns running the version it ran before without reporting an outcome of this upgrade: **Running** failed, saying the server is still on that version;
- the server returns without saying anything of its upgrade before the reconnect deadline: **Running** failed, saying the server did not report how the upgrade ended;
- the server returns as one this client cannot speak to: **Running** failed, with the connection's own explanation of which side needs updating;
- no status arrives within the reconnect deadline, or the connection layer stops trying: **Restarting** failed, saying the server did not come back, and the window keeps its ordinary offline presentation. A later return of the server SHALL NOT reopen or change that card.

An outcome the client has already seen, or one stamped before the upgrade began, is not this upgrade's: the version the server runs SHALL decide the ending instead, and the client SHALL NOT wait for a further outcome once the server has returned. Every state of a followed upgrade, including one restored after a reload, SHALL reach one of these endings within the reconnect deadline.

The card SHALL offer nothing to dismiss it before the upgrade ends. On the device that started the upgrade, the card SHALL keep its final state until the user closes it; on any other device it SHALL be removed when the upgrade ends. The client SHALL tell a reported success, a reported rollback, a version moved to the target, and a server that did not come back once each as an entry in the header Notifications list, counted on the Notifications control like every other notification and kept until dismissed. The outcome SHALL NOT open a popup over the workspace on a device whose card is not already showing.

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

#### Scenario: Confirming shows the steps

- **WHEN** the user confirms and the server accepts
- **THEN** the confirmation is replaced by a progress card, centred and modal over the whole window, listing **Starting the upgrade** done, **Installing 5.2.0** running, and **Restarting** and **Running 5.2.0** waiting

#### Scenario: Recreate wording

- **WHEN** the user confirms the recreate mode
- **THEN** the card's third step reads **Recreating the container**

#### Scenario: The restart is a step, not an error

- **WHEN** the server restarts during a followed upgrade and the connection drops
- **THEN** the same card, in the same place, shows **Restarting** running, no stall or connection-lost text is shown, and the connection's status reads "Restarting for upgrade…"

#### Scenario: Card survives the reconnect

- **WHEN** the connection returns and the workspace is replaced on the new connection
- **THEN** the same progress card is still shown with **Restarting** done

#### Scenario: Reloaded mid-upgrade

- **WHEN** the device that started the upgrade reloads its document while the server is restarting
- **THEN** once the connection identifies the server, the progress card is shown again naming the same target version and mode

#### Scenario: Progress on another device

- **WHEN** one device starts an upgrade while a second is attached to the same server
- **THEN** the second device shows the same modal progress card from **Installing** onwards, offers no upgrade action, and removes the card when the upgrade ends, leaving the outcome in its Notifications list

#### Scenario: Success

- **WHEN** the connection returns and the status reports the completed move
- **THEN** the progress card shows every step done and names `5.2.0`, the warning icon is gone, and the Notifications list holds one entry saying the server is now on `5.2.0`

#### Scenario: Rolled back

- **WHEN** the connection returns and the status reports a rollback
- **THEN** the progress card marks **Running 5.2.0** failed with the reason and says `5.1.1` is running again, the Notifications list holds one matching entry, and the warning icon remains

#### Scenario: Back on the old version without an outcome

- **WHEN** the connection returns, the status reports no upgrade, and the server still runs `5.1.1`
- **THEN** the progress card marks **Running 5.2.0** failed, saying the server is still on `5.1.1`

#### Scenario: Back on the target with an outcome already seen

- **GIVEN** a device reopened during an upgrade it started, and the success outcome was already seen before the window closed
- **WHEN** the connection returns, reporting that outcome and running `5.2.0`
- **THEN** every step is done, and the card is not left waiting on **Running 5.2.0**

#### Scenario: Back but silent

- **WHEN** the connection returns and no upgrade status arrives before the reconnect deadline
- **THEN** the progress card marks **Running 5.2.0** failed, saying the server did not report how the upgrade ended

#### Scenario: Back as an incompatible server

- **WHEN** the connection returns and the server is one this client cannot speak to
- **THEN** the progress card marks **Running 5.2.0** failed with the explanation of which side needs updating

#### Scenario: Server does not come back

- **WHEN** no status arrives from the server within the reconnect deadline
- **THEN** the progress card marks **Restarting** failed, saying the server did not come back, the Notifications list holds one entry saying so, and the window keeps its ordinary offline presentation

#### Scenario: Nothing beneath the card is usable

- **WHEN** the card is shown while the upgrade runs
- **THEN** the workspace beneath it cannot be used and the card offers no way to dismiss it

#### Scenario: Closing the finished card

- **WHEN** the upgrade has ended and the user closes the card on the device that started it
- **THEN** the card is gone and the Notifications entry remains until dismissed
