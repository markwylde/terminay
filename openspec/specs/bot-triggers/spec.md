# bot-triggers Specification

## Purpose

Define bot schedules and event triggers, bounded firing admission, and management through the shared scheduler.

## Requirements

### Requirement: Bot trigger definition

The bot SHALL be able to manage its own triggers through authenticated runtime tools as specified by bot-message-log. Agent operations SHALL use the same validation, persistence and scheduler as the user interface, and SHALL not grant access to another bot's triggers.

A bot SHALL have at most 50 triggers. Each trigger SHALL have:

- a name;
- an enabled state;
- exactly one schedule or event;
- a prompt of at most 32 KiB of UTF-8.

A trigger that fires SHALL start a new session of its bot, with the prompt as the first message. A trigger with an empty prompt SHALL be refused on save, naming the prompt. A disabled trigger SHALL NEVER fire. A trigger SHALL belong to its bot alone, and SHALL be removed with it. Edits SHALL apply to firings that occur after the edit.

#### Scenario: Trigger starts a session

- **WHEN** a trigger with the prompt "Check the nightly build and summarise failures" fires while its bot is idle
- **THEN** a new session of its bot starts with that prompt as its first message

#### Scenario: Disabled trigger

- **WHEN** a disabled trigger's schedule comes due
- **THEN** no session starts

### Requirement: Schedule triggers

A schedule trigger SHALL be one of the following:

- **once**, at a date and time;
- **every** N minutes or hours, where N is at least 5 minutes;
- a standard five-field **cron** expression.

The editor SHALL describe the schedule in plain words, and SHALL preview its next five firings before saving. A schedule that cannot be parsed, or that never matches, SHALL be refused.

#### Scenario: Weekday cron

- **WHEN** a user chooses weekdays at 09:00
- **THEN** the schedule is `0 9 * * 1-5`, is described as every weekday at 09:00, and previews the next five firings

#### Scenario: Interval too short

- **WHEN** a user saves an every-2-minutes trigger
- **THEN** the save is refused, naming the 5-minute minimum

### Requirement: Schedule semantics

Each kind of schedule SHALL be evaluated as follows:

- **Cron** schedules SHALL use the same parser, presets, time zone, and one-minute resolution as automation schedules. The server's local time zone applies, including its daylight-saving rules.
- **Every** schedules SHALL be anchored at the time the trigger was last saved or enabled, and SHALL be measured in elapsed time. Daylight-saving changes SHALL NOT shift them. After a restart, the next firing SHALL be computed from the anchor.
- **Once** triggers SHALL be disabled after they fire.

#### Scenario: Interval across a restart

- **WHEN** a trigger set to every 6 hours was enabled at 08:00 and the server restarts at 12:00
- **THEN** the next firing is 14:00

#### Scenario: Interval across daylight saving

- **WHEN** an every-1-hour trigger runs across the night the clocks go back
- **THEN** it fires once every 60 elapsed minutes

### Requirement: Event triggers

An event trigger SHALL fire on one of the Terminay events that automations offer, observed across every project on the owning server and following the same firing rules. Activity inside a bot's own container SHALL NOT raise these events.

The session SHALL receive the event's context as a bounded block after the prompt, with the same fields an automation run receives. The context SHALL NEVER contain capability tokens, secrets, terminal output, or provider journal content.

#### Scenario: Agent needs input in a project

- **WHEN** an agent in any project enters `waiting` and a bot has an enabled Agent needs input trigger
- **THEN** a session of that bot starts with the trigger's prompt followed by the event's subject terminal title, project title, and agent provider

#### Scenario: No sensitive context

- **WHEN** an event trigger's session starts
- **THEN** its first message contains no capability token, secret, terminal output, or provider journal content

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

### Requirement: Triggers tab

The Triggers tab SHALL list a bot's triggers. For each, it SHALL show the kind, a plain-words description, whether it is enabled, its last firing and that firing's outcome, and its next firing. It SHALL also show the bot's upcoming firings, across all its triggers, in time order for the next seven days.

Each trigger SHALL offer edit, enable or disable, delete, and **Run now**. Run now SHALL queue a session whose origin is Run now, whether or not the trigger is enabled.

The context rail of the bot tab SHALL show the next three distinct triggers to fire, each once at its next firing, in time order. A trigger with further firings in the upcoming window SHALL carry a repeat mark.

The Triggers page SHALL use the available panel width, retaining the panel's standard padding. Its toolbar, trigger list and empty state SHALL not be constrained by a fixed maximum content width.

#### Scenario: Wide bot panel

- **WHEN** a user opens Triggers in a wide bot panel
- **THEN** its toolbar and list or empty state span the available width inside the standard padding

#### Scenario: Run now

- **WHEN** a user chooses Run now on a disabled trigger of an idle bot
- **THEN** a session with origin Run now starts with that trigger's prompt, and the trigger stays disabled

#### Scenario: Upcoming firings

- **WHEN** a bot has an hourly trigger and a daily trigger
- **THEN** the Triggers tab shows their firings for the next seven days interleaved in time order

#### Scenario: Repeating trigger in the rail

- **WHEN** a bot has a trigger firing every minute and a daily trigger
- **THEN** the context rail lists each trigger once at its next firing, and the every-minute trigger shows a repeat mark

### Requirement: Automations keep their behaviour on the shared scheduler

Automations and bot triggers SHALL share one schedule engine and one event fan-out. Every automation requirement SHALL hold unchanged on the shared engine.

#### Scenario: Automation unaffected

- **WHEN** a bot trigger and an automation are both due in the same minute
- **THEN** each fires once under its own rules, and the automation's run log is the same as it would be with no bots present

### Requirement: Trigger source picker and quick start

The trigger editor SHALL choose a trigger's source from a single picker that groups the sources under Files, Network, Commands, and Time, and that describes each source in a line of its own. The editor's other choices SHALL use the same picker.

A bot with no triggers SHALL show one empty state that offers a quick start for each source, and choosing one SHALL open the editor on that source. While a bot with no triggers is being given its first, the editor SHALL be shown without an empty list beside it.

#### Scenario: Choosing a source

- **WHEN** a user opens the Source picker in the trigger editor
- **THEN** it lists the sources under Files, Network, Commands, and Time, each with a description, and choosing one switches the editor to that source

#### Scenario: Quick start

- **WHEN** a bot has no triggers and the user chooses File or folder changes in the empty state
- **THEN** the trigger editor opens alone, on the File or folder changes source

### Requirement: Trigger table and editor sheet

The Triggers tab SHALL list a bot's triggers in a table. Each row SHALL show the trigger's source, name and plain-words condition, its status, when it was last checked, its last firing, its next firing, an enable control, Run now, Sessions, and delete. Activating a row SHALL open the trigger editor as a sheet over the table. The sheet for a saved trigger SHALL also offer Sessions. Sessions SHALL open the bot's Sessions tab filtered to the sessions that trigger started, as specified by terminay-bots. Closing the sheet SHALL keep an unsaved draft for when the same trigger, or a new trigger, is opened again.

#### Scenario: A trigger that checks without firing

- **WHEN** a command trigger fires when its output starts matching, and its output keeps matching
- **THEN** its row shows a recent last check while its last firing stays at the moment it started matching

#### Scenario: Reopening a draft

- **WHEN** a user closes the sheet with unsaved changes to a new trigger and then chooses New trigger
- **THEN** the sheet opens with those changes

#### Scenario: Showing a trigger's sessions

- **WHEN** a user chooses Sessions on the row of a trigger that has fired twice and been run once with Run now
- **THEN** the Sessions tab opens listing those three sessions, with a filter control naming the trigger

#### Scenario: Sessions from the editor sheet

- **WHEN** a user chooses Sessions in the sheet of a saved trigger
- **THEN** the Sessions tab opens filtered to that trigger

#### Scenario: Triggers with the same name

- **WHEN** two triggers share a name and a user chooses Sessions on one of them
- **THEN** only the sessions of the chosen trigger are listed

#### Scenario: A new trigger has no Sessions action

- **WHEN** the sheet is open for a trigger that has not been saved
- **THEN** the sheet does not offer Sessions

### Requirement: Trigger validation waits for the user

The trigger editor SHALL NOT show a problem with a form the user has not edited. After an edit, a problem with the condition SHALL be shown inline in the When section. A refused save SHALL show its reason beside the save control. A preview that the server cannot compute SHALL NOT be shown as an error.

#### Scenario: Typing a match

- **WHEN** a user is part-way through typing the text to match
- **THEN** no error banner appears, and saving with an invalid condition shows the reason beside Save

### Requirement: Explicit repeat firing

For a match on text, a regular expression, or an exit code, the editor SHALL offer a choice between firing when the result starts matching and firing on every matching check, and SHALL describe each.

#### Scenario: Choosing repeat firing

- **WHEN** a user chooses On every matching check for a command whose output always matches
- **THEN** each check starts a session

### Requirement: Trigger health agrees with whether the trigger can fire

A trigger's reported health state SHALL be `disabled` exactly when the trigger is disabled or its bot is disabled. An enabled trigger on an enabled bot SHALL report `waiting` until its source reports a more specific state, including after it is created, enabled or retried, and after it fires on a schedule. Re-enabling a bot SHALL keep any specific state its triggers last reported.

#### Scenario: A new interval trigger

- **WHEN** a user creates an enabled interval trigger and it has not yet fired
- **THEN** its health state is `waiting`

#### Scenario: A trigger created disabled

- **WHEN** a user creates a trigger with its enable switch off
- **THEN** its health state is `disabled`

#### Scenario: Re-enabling a trigger

- **WHEN** a user disables a trigger and then enables it again
- **THEN** its health state is `disabled` while it is off and `waiting` once it is back on, before any check runs

#### Scenario: An interval trigger after it fires

- **WHEN** an enabled interval trigger fires on its schedule
- **THEN** its health state is not `disabled`

#### Scenario: A one-shot trigger after it fires

- **WHEN** a once trigger fires and is disabled as a result
- **THEN** its health state is `disabled`

#### Scenario: Disabling the bot

- **WHEN** a user disables a bot whose triggers are enabled
- **THEN** every one of its triggers reports `disabled` health, although each trigger's switch is still on

#### Scenario: Enabling a trigger while its bot is disabled

- **WHEN** a user enables a trigger on a disabled bot
- **THEN** its health state stays `disabled` until the bot is enabled

#### Scenario: Re-enabling the bot

- **WHEN** a bot is enabled again after its triggers were disabled with it
- **THEN** a trigger that never reported anything reports `waiting`, and a trigger whose last report was `healthy` or `failed` reports that state again

#### Scenario: Retrying a trigger

- **WHEN** a user retries an enabled trigger
- **THEN** its health state is never `disabled`, and a schedule trigger, which runs no check, reports `waiting`

#### Scenario: A stored disabled state on an active trigger

- **WHEN** the server lists an enabled trigger on an enabled bot whose stored health state is `disabled`
- **THEN** it reports `waiting`

### Requirement: Trigger status pill agrees with the switches

The Triggers table SHALL show a Disabled status, in a neutral tone, for a trigger that is disabled or whose bot is disabled. It SHALL never label a trigger Disabled while both the trigger and its bot are enabled, whatever health state the server sends.

#### Scenario: A disabled trigger

- **WHEN** a trigger's switch is off
- **THEN** its row shows a neutral Disabled status

#### Scenario: A disabled bot

- **WHEN** a trigger's switch is on but its bot is disabled
- **THEN** its row shows a neutral Disabled status

#### Scenario: The table never contradicts the switch

- **WHEN** the server sends `disabled` health for a trigger whose switch is on and whose bot is enabled
- **THEN** the row shows Waiting, not Disabled

### Requirement: Source runs that end without a result are classified

A source run that ends without a result frame SHALL be classified from server state and exit status, never stderr text, in this order: cancelled; over time limit (the source's deadline or the test window fired); worker not executable (exit 126 or 127); otherwise interrupted, including a broken stream or unknown exit. Existing engine and process-limit causes SHALL be kept.

#### Scenario: The worker cannot be executed

- **WHEN** a command check's exec exits 127 without output because the source worker is missing or not executable
- **THEN** the reason says the source worker could not be executed in the bot's container and that recreating the bot updates its image

#### Scenario: Host wakes from sleep during a check

- **WHEN** a command check's exec stream ends or errors without output and the exit status is not 126 or 127
- **THEN** the check is classified as interrupted, and its reason says the check was interrupted before it reported, without telling the owner to recreate the bot

#### Scenario: Test window is shorter than the command

- **WHEN** a trigger test runs a command that takes longer than the 10-second test window
- **THEN** the test fails with a reason naming the 10-second limit

#### Scenario: Container runs out of processes

- **WHEN** a check ends without output and the existing process-limit classification finds the container at its process limit
- **THEN** the health error keeps the process-limit cause

### Requirement: Source run reasons include bounded redacted diagnostics

A reason for a source run that ended without a result SHALL include the exit status (or say it is unknown) and at most 1 KiB from the tail of the worker's stderr. Stderr SHALL be bounded while it is read. The tail SHALL be redacted with the bot's credential and header secrets before it is stored in health or passed to a failure follow-up. A partial line at the start of the retained tail SHALL be dropped. If redaction is unavailable, the stderr tail SHALL be omitted.

#### Scenario: Worker stderr contains a secret

- **WHEN** an interrupted run's stderr contains one of the bot's secrets
- **THEN** the stored health error shows `[redacted]` in its place

#### Scenario: Large stderr

- **WHEN** an interrupted run writes several megabytes of stderr
- **THEN** the reason contains at most 1 KiB of it and the server holds only a bounded tail while reading

### Requirement: An interrupted polled check is retried once

A live command or HTTP check classified as interrupted SHALL be retried once, about 5 seconds later, in the same check, only after cleanup of the first run succeeded. Otherwise it SHALL fail at once. While waiting, health SHALL be *retrying*, with the reason and the next retry time. Only a failed retry SHALL record the check as failed, with its reason. Tests and other classifications SHALL NOT retry.

#### Scenario: One interruption recovers

- **WHEN** a command check is interrupted and its retry returns a result
- **THEN** the result is evaluated as that check's observation and health becomes healthy

#### Scenario: Interrupted twice

- **WHEN** a command check is interrupted and its retry is interrupted as well
- **THEN** health becomes failed with the second interruption's reason

#### Scenario: Over the time limit

- **WHEN** a live command check exceeds its time limit
- **THEN** it fails at once without a retry

### Requirement: A pending retry is cancelled with its trigger

A pending retry SHALL be cancelled when its trigger is disabled, edited, reset or deleted, when its bot is disabled, or when the server stops. A retry SHALL NOT overlap another check of the same trigger. A scheduled check that falls due while the retry is pending SHALL NOT start alongside it; the trigger's next check after the retry covers that time.

#### Scenario: Trigger disabled during the retry delay

- **WHEN** a trigger is disabled while its interrupted check waits to retry
- **THEN** the retry does not run

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
