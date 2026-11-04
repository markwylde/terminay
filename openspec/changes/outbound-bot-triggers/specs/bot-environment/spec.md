## MODIFIED Requirements

### Requirement: Container lifecycle

A bot's environment SHALL be in one of these states: not created, building, starting, running, stopping, stopped, or failed. Environment › Overview SHALL offer Start, Stop, Restart, and Recreate.

- **Stop** SHALL stop the bot's running session as session Stop does, then stop the container.
- **Recreate** SHALL remove the container and create it again from the current image, keeping the home.
- **Idle stop.** A running bot SHALL be stopped after an idle period with no running or queued session, no open shell, no viewed desktop, no in-flight source check and no enabled continuous file/SSE watcher. The idle period SHALL be settable per bot, SHALL default to 30 minutes, and SHALL also allow never.
- **Starting on demand.** A session, source test or enabled trigger that needs a stopped container SHALL start it. A future scheduled check SHALL not prevent idle shutdown between checks. Completed checks SHALL count as activity, without retaining an idle AI provider.
- **Availability is separate.** Container Stop SHALL stop current sessions and source workers but SHALL not disable the bot; enabled triggers SHALL be able to start it again. The UI SHALL explain this and offer Disable bot for a persistent pause. A disabled bot SHALL not be woken automatically. Continuous watchers SHALL be re-established for an enabled bot after container/server recovery, and SHALL count as activity while active. Container recreation SHALL preserve server-owned trigger definitions and observation state.
- **Reconciliation.** The server SHALL reconcile each bot's recorded state with the engine at startup and whenever the engine reports a container event.

#### Scenario: Idle stop

- **WHEN** a bot has had no running or queued session, open shell, viewed desktop, in-flight check or enabled continuous watcher for its idle period
- **THEN** its container is stopped and its card shows stopped

#### Scenario: Removed outside Terminay

- **WHEN** a user removes a bot's container with `docker rm -f` while Terminay is running
- **THEN** the bot is shown as not created, and its next session creates the container again

#### Scenario: Long interval saves compute

- **WHEN** an enabled bot has only an every-6-hours command check and reaches its configured idle timeout between checks
- **THEN** its container stops and the next due check starts it again without enabling or creating an AI session merely to check

#### Scenario: Continuous watcher

- **WHEN** an enabled bot has an enabled continuous SSE or file source
- **THEN** the container stays running and the UI names the source keeping it active

#### Scenario: Stop is not Disable

- **WHEN** a user stops an enabled bot container and its next check becomes due
- **THEN** the check can start that container again, while Disable bot would have prevented that wake

