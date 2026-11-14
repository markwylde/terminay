## MODIFIED Requirements

### Requirement: Container lifecycle

A bot's environment SHALL be in one of these states: not created, building, starting, running, stopping, stopped, or failed. Environment › Overview SHALL offer Start, Stop, Restart, and Recreate.

- **Stop** SHALL stop the bot's running session as session Stop does, then stop the container.
- **Recreate** SHALL remove the container and create it again from the current image, keeping the home.
- **Idle stop.** A running bot SHALL be stopped after an idle period with no running or queued session, no open shell, and no viewed desktop. The idle period SHALL be settable per bot, SHALL default to 30 minutes, and SHALL also allow never.
- **Starting on demand.** A session or trigger that needs a stopped container SHALL start it.
- **Reconciliation.** The server SHALL reconcile each bot's recorded state with the engine at startup and whenever the engine reports a container event. Startup reconciliation SHALL NOT delay the server becoming ready. Bot triggers SHALL start only after it finishes, and a session requested before it finishes SHALL wait for it.

#### Scenario: Idle stop

- **WHEN** a bot has had no running or queued session, open shell, or viewed desktop for its idle period
- **THEN** its container is stopped and its card shows stopped

#### Scenario: Removed outside Terminay

- **WHEN** a user removes a bot's container with `docker rm -f` while Terminay is running
- **THEN** the bot is shown as not created, and its next session creates the container again

#### Scenario: Engine slow to answer at startup

- **WHEN** the container engine takes a minute to answer while Terminay Server starts
- **THEN** the server becomes ready and opens projects and terminals without waiting for it, and the bots reconcile once the engine answers
