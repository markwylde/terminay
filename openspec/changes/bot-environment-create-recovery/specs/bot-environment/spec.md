## MODIFIED Requirements

### Requirement: Container lifecycle

A bot's environment SHALL be in one of these states: not created, building, starting, running, stopping, stopped, or failed. Environment › Overview SHALL offer Start, Stop, Restart, and Recreate.

- **Stop** SHALL stop the bot's running session as session Stop does, then stop the container.
- **Recreate** SHALL remove the container and create it again from the current image, keeping the home.
- **Idle stop.** A running bot SHALL be stopped after an idle period with no running or queued session, no open shell, and no viewed desktop. The idle period SHALL be settable per bot, SHALL default to 30 minutes, and SHALL also allow never.
- **Starting on demand.** A session or trigger that needs a stopped container SHALL start it.
- **Reconciliation.** The server SHALL reconcile each bot's recorded state with the engine at startup and whenever the engine reports a container event.
- **Naming the start action.** While the environment is not created, Overview SHALL name its start action **Create environment** and SHALL also offer it in the Actions menu. After a failure it SHALL name the action **Try again**.
- **Unavailable actions.** An Overview action that cannot run in the current state SHALL say why beside its name.
- **Leftover name.** When the engine refuses the bot's container name, lists no container with it, and identifies storage that a removed container left behind under exactly that name, creation SHALL remove that storage by its own identifier and create the container once more. Nothing SHALL be removed by name, a name held by a listed container SHALL NOT be cleared, and a second refusal SHALL fail the start.

#### Scenario: Idle stop

- **WHEN** a bot has had no running or queued session, open shell, or viewed desktop for its idle period
- **THEN** its container is stopped and its card shows stopped

#### Scenario: Removed outside Terminay

- **WHEN** a user removes a bot's container with `docker rm -f` while Terminay is running
- **THEN** the bot is shown as not created, and its next session creates the container again

#### Scenario: Name held by leftover storage

- **WHEN** a bot is not created and the engine refuses its container name without listing a container that has it, while holding leftover storage under that name
- **THEN** that storage is removed by its identifier, the container is created, and the bot reaches running

#### Scenario: Name refused with no leftover storage

- **WHEN** the engine refuses the bot's container name and identifies no leftover storage under it
- **THEN** nothing is removed, the start fails, and the bot reports a conflict with an existing container

#### Scenario: Overview for a bot with no container

- **WHEN** a user opens Environment › Overview for a bot that is not created
- **THEN** the primary action reads Create environment, the Actions menu offers Create environment, and Restart and Recreate each say why they cannot run
