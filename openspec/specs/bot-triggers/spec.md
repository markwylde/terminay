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
- **Already pending.** If the same trigger already has a pending firing, the new firing SHALL be skipped and recorded with the reason "bot busy".
- **Server was off.** A schedule whose time passed while the server was not running SHALL be skipped, not caught up. The trigger SHALL show its missed firings until the user dismisses them.
- **Cannot start.** A firing that cannot start a session SHALL be recorded as failed with the reason. The reasons are: container engine unavailable, agent not ready, or image out of date and building failed.

#### Scenario: Bot busy

- **WHEN** a trigger comes due while its bot runs a chat turn
- **THEN** the firing starts an independent execution if work capacity permits, otherwise it waits until capacity becomes available

#### Scenario: Second firing while pending

- **WHEN** an every-5-minutes trigger comes due again while its previous firing is still queued
- **THEN** the new firing is recorded as skipped because the bot is busy

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

The Triggers tab SHALL list a bot's triggers in a table. Each row SHALL show the trigger's source, name and plain-words condition, its status, when it was last checked, its last firing, its next firing, an enable control, Run now, and delete. Activating a row SHALL open the trigger editor as a sheet over the table. Closing the sheet SHALL keep an unsaved draft for when the same trigger, or a new trigger, is opened again.

#### Scenario: A trigger that checks without firing

- **WHEN** a command trigger fires when its output starts matching, and its output keeps matching
- **THEN** its row shows a recent last check while its last firing stays at the moment it started matching

#### Scenario: Reopening a draft

- **WHEN** a user closes the sheet with unsaved changes to a new trigger and then chooses New trigger
- **THEN** the sheet opens with those changes

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
