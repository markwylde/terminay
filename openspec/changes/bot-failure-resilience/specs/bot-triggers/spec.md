## ADDED Requirements

### Requirement: Trigger failure settings

Each trigger SHALL have two failure settings:

- **Startup retries**, a whole number from 0 to 3, default 3: how many times an execution it starts retries a temporary startup failure, as specified by bot-execution-resilience.
- **When the bot needs you**, either **Pause this trigger**, the default, or **Keep running**: what the trigger does while the user owes it an action.

The trigger editor SHALL offer both settings and describe each in plain words. Runtime trigger tools SHALL read and write them under the same validation as the editor. A value outside its range SHALL be refused on save, naming the setting. A trigger saved without these settings SHALL use the defaults. Startup retries SHALL be read when an execution is created, so an edit does not change an execution already in progress. When the bot needs you SHALL take effect immediately, including for a trigger that is already waiting for the user.

#### Scenario: Defaults

- **WHEN** a user creates a trigger without changing its failure settings
- **THEN** it has Startup retries 3 and pauses when the bot needs the user

#### Scenario: Editing retries during a retry

- **WHEN** a user changes Startup retries from 3 to 0 while an execution of that trigger waits for its second attempt
- **THEN** that execution still makes up to 3 retries, and later executions make none

#### Scenario: Switching a waiting trigger to Keep running

- **WHEN** a paused trigger that is waiting for the user is switched to Keep running
- **THEN** its next due firing starts an execution, and it still shows Needs you

#### Scenario: Out-of-range retries

- **WHEN** a bot's trigger tool saves Startup retries 5
- **THEN** the save is refused, naming Startup retries and its range of 0 to 3

### Requirement: A trigger can wait for the user

A trigger with a blocker recorded by a `needs-human` outcome, as specified by bot-execution-resilience, SHALL be *waiting for the user* until the user chooses **Resume**, the bot reports `fixed` for it, or the trigger is deleted. Disabling and enabling the trigger SHALL NOT clear the blocker. While it waits:

- a trigger set to Pause this trigger SHALL NOT start executions for its firings. Each due firing, and each of its firings already queued but not yet started when the blocker is recorded, SHALL be recorded as skipped with the reason "waiting for you". The check SHALL also be made when queued work is admitted;
- a trigger set to Keep running SHALL keep firing as usual;
- Run now SHALL still start an execution and SHALL NOT clear the blocker.

Resume SHALL clear the blocker. A paused trigger SHALL fire again at its next due firing after Resume, without catching up on firings skipped while it waited. The blocker SHALL survive a server restart.

#### Scenario: Paused trigger has nothing coming up

- **WHEN** a trigger is paused because it waits for the user
- **THEN** its row shows Next as Paused and its firings are left out of the upcoming list until Resume

#### Scenario: Paused trigger comes due

- **WHEN** an hourly trigger set to Pause this trigger is waiting for the user and its next hour comes due
- **THEN** no execution starts and the firing is recorded as skipped with the reason "waiting for you"

#### Scenario: Blocker recorded while a firing is queued

- **WHEN** a paused-mode trigger's firing is queued behind other work and a sibling execution reports `needs-human` for that trigger
- **THEN** the queued firing is skipped with the reason "waiting for you" and never starts

#### Scenario: User resumes

- **WHEN** the user chooses Resume on that trigger at 10:20
- **THEN** its blocker clears and its 11:00 firing starts an execution, with no catch-up for 10:00

#### Scenario: Keep running

- **WHEN** a trigger set to Keep running is waiting for the user and comes due
- **THEN** it starts an execution as usual and still shows Needs you

#### Scenario: Restart while waiting

- **WHEN** the server restarts while a trigger is waiting for the user
- **THEN** the trigger is still waiting for the user, with the same reason and action

### Requirement: Needs you is shown on the trigger

The Triggers table row and the editor sheet of a trigger that is waiting for the user SHALL show a **Needs you** status in an attention tone, the stored reason and action, and a **Resume** control. Disabled status SHALL take precedence over Needs you in the row's status. Resume SHALL also be offered while the trigger or its bot is disabled.

#### Scenario: Row shows the action

- **WHEN** a trigger is waiting for the user with the action "Add the support portal password to the bot's secrets"
- **THEN** its row shows Needs you, that action, and Resume

#### Scenario: Disabled and waiting

- **WHEN** a trigger waiting for the user is disabled
- **THEN** its row status shows Disabled and the row still offers Resume

## MODIFIED Requirements

### Requirement: Busy, overlapping, and missed firings

- **Bot busy.** A trigger SHALL start a fresh execution while work capacity is available and otherwise wait in the bounded execution queue. Completed providers SHALL not be retained.
- **Queue full.** If the bot's queue already holds 20 items, the firing SHALL be skipped, with the reason "bot busy".
- **Trigger disabled or deleted.** Disabling or deleting a trigger SHALL remove its pending firing.
- **Already pending.** If the same trigger already has a pending firing, the new firing SHALL be skipped and recorded with the reason "bot busy". An execution that has not reached task hand-over SHALL count as its trigger's pending firing. When the next firing is due, that execution SHALL be handled as specified by bot-execution-resilience: replaced when it is waiting, and allowed to finish its current attempt when one is in progress.
- **Waiting for you.** A trigger that is paused because it waits for the user SHALL skip its firing, with the reason "waiting for you".
- **Server was off.** A schedule whose time passed while the server was not running SHALL be skipped, not caught up. The trigger SHALL show its missed firings until the user dismisses them.
- **Cannot start.** A firing that cannot start a session SHALL be recorded as failed with the reason. The reasons are: container engine unavailable, agent not ready, or image out of date and building failed.

#### Scenario: Bot busy

- **WHEN** a trigger comes due while its bot runs a chat turn
- **THEN** the firing starts an independent execution if work capacity permits, otherwise it waits until capacity becomes available

#### Scenario: Second firing while pending

- **WHEN** an every-5-minutes trigger comes due again while its previous firing is still queued
- **THEN** the new firing is recorded as skipped because the bot is busy

#### Scenario: Next firing while a retry waits

- **WHEN** an every-5-minutes trigger comes due while its previous execution is waiting for a startup retry
- **THEN** the waiting execution ends as failed, replaced by the next firing, and the new firing starts a fresh execution

#### Scenario: Server was off

- **WHEN** the server starts after a daily trigger's due time has passed
- **THEN** no session starts for that firing and the trigger shows one missed firing

#### Scenario: Engine unavailable

- **WHEN** a trigger fires while the container engine is not running
- **THEN** the firing is recorded as failed, with engine not running as the reason
