## MODIFIED Requirements

### Requirement: Bot trigger definition

The bot SHALL be able to manage its own triggers through authenticated runtime tools as specified by bot-message-log. Agent operations SHALL use the same validation, persistence and scheduler as the user interface, and SHALL not grant access to another bot's triggers.

A bot SHALL have at most 50 triggers. Each trigger SHALL have:

- a name;
- an enabled state;
- exactly one schedule or event;
- a prompt of at most 32 KiB of UTF-8;
- optionally, a gate, as specified by Trigger gate.

A trigger that fires SHALL start a new session of its bot, with the prompt as the first message, unless its gate skips the firing. A trigger with an empty prompt SHALL be refused on save, naming the prompt. A disabled trigger SHALL NEVER fire. A trigger SHALL belong to its bot alone, and SHALL be removed with it. Edits SHALL apply to firings that occur after the edit: a firing uses the prompt and the gate its trigger had when the firing occurred.

#### Scenario: Trigger starts a session

- **WHEN** a trigger with the prompt "Check the nightly build and summarise failures" fires while its bot is idle
- **THEN** a new session of its bot starts with that prompt as its first message

#### Scenario: Disabled trigger

- **WHEN** a disabled trigger's schedule comes due
- **THEN** no session starts

#### Scenario: Gate edited after a firing occurred

- **WHEN** a trigger fires, and its gate is changed before that firing has started its session
- **THEN** that firing is decided by the gate the trigger had when it fired

## ADDED Requirements

### Requirement: Trigger gate

A trigger SHALL optionally have a **gate**: the path of a script in its bot's container. A gate SHALL be available for every trigger source. The path SHALL be absolute, or relative to the bot's home directory. It SHALL be at most 4096 bytes of UTF-8 and SHALL contain no line break or NUL; a gate outside these limits SHALL be refused on save, naming the gate. An empty gate SHALL mean the trigger has no gate.

When a firing whose origin is the trigger is about to start a session, the server SHALL first run the gate in the bot's container, as the bot user, with the bot's home directory as its working directory, with no arguments and a limit of 30 seconds for the script. A gate file that is executable SHALL be executed directly; one that is not SHALL be run with `bash`. The gate SHALL run only after the firing has passed the checks of Busy, overlapping, and missed firings, so a firing skipped as bot busy or waiting for you SHALL NOT run it. A trigger without a gate SHALL fire as if gates did not exist.

The gate's verdict SHALL be read from its standard output, ignoring leading and trailing white space:

- **Empty output and exit status 0** — the session starts.
- **Any text**, whatever the exit status — the firing is skipped, as specified by Gated firings are skipped, not failed.
- **Anything else** — the gate is broken, as specified by A broken gate fails open.

**Run now** SHALL NOT run the gate.

#### Scenario: Nothing to do

- **WHEN** a nightly trigger with the gate `./check-new-pulls.sh` comes due and the script prints "no pull requests today" and exits 0
- **THEN** no session starts

#### Scenario: Work to do

- **WHEN** the same trigger comes due and the script prints nothing and exits 0
- **THEN** a session starts with the trigger's prompt, exactly as it would without a gate

#### Scenario: White space only

- **WHEN** a gate prints only a blank line and exits 0
- **THEN** the session starts

#### Scenario: Output with a failing exit status

- **WHEN** a gate prints "nothing new" and exits 3
- **THEN** the firing is skipped with that output as its reason

#### Scenario: Gate on a file trigger

- **WHEN** a File or folder changes trigger with a gate fires and the gate prints "only lock files changed"
- **THEN** no session starts

#### Scenario: Run now bypasses the gate

- **WHEN** a user chooses Run now on a trigger whose gate would print "nothing to do"
- **THEN** the gate is not run and a session with origin Run now starts

#### Scenario: Distinct gated firings wait for capacity

- **WHEN** a gated trigger comes due twice while work capacity is occupied and both gates let their firing through
- **THEN** both firings wait under ordinary bounded admission, each gate runs once, and each firing starts its own session as capacity becomes available

#### Scenario: Script that is not executable

- **WHEN** a gate names a shell script without its executable bit and the script prints nothing
- **THEN** it is run with `bash` and the session starts

#### Scenario: Path with shell characters

- **WHEN** a gate's path contains a space, a quote and a `$`
- **THEN** the file at exactly that path is run and nothing else is executed

#### Scenario: Invalid gate path

- **WHEN** a trigger is saved with a gate containing a line break
- **THEN** the save is refused, naming the gate

### Requirement: A gate gives one verdict for a firing

A gate SHALL give at most one verdict for a firing while the server keeps running: once a verdict is reached, the gate SHALL NOT run again for that firing, however long the firing then waits to start. A gate run SHALL be ended without a verdict when its trigger is disabled or deleted, its bot is disabled, or the server stops. A verdict that arrives after any of those SHALL be discarded. A firing whose gate run ended without a verdict SHALL be handled as that action specifies; if the firing is still pending when dispatch resumes, including after a server restart, its gate SHALL run again.

#### Scenario: Verdict is kept while the firing waits

- **WHEN** a gate lets a firing through and the firing then waits for work capacity
- **THEN** the gate is not run again before its session starts

#### Scenario: Trigger disabled while its gate runs

- **WHEN** a user disables a trigger while its gate is running
- **THEN** the gate is ended, no session starts, and the firing is recorded as cancelled

#### Scenario: Bot disabled while a gate runs

- **WHEN** a bot is disabled while one of its gates is running and is enabled again later with the firing still pending
- **THEN** no session starts while the bot is disabled, and the gate runs again when dispatch resumes

#### Scenario: Server restarts during a gate

- **WHEN** the server stops while a gate is running and the firing is still pending after it starts again
- **THEN** the gate runs again for that firing

### Requirement: Gated firings are skipped, not failed

A firing skipped by its gate SHALL be recorded with the outcome `skipped` and a reason of `gate: ` followed by the gate's output. The output SHALL first be redacted with the bot's credentials, then have each run of white space replaced by one space, then be cut to at most 512 bytes of UTF-8, not counting the `gate: ` prefix. If redaction is unavailable, the reason SHALL be `gate` alone.

A gated firing SHALL start no session, SHALL NOT change the trigger's health, SHALL NOT start a failure follow-up, and SHALL NOT count as a failure of the trigger. A once trigger whose firing is gated SHALL still be disabled. An observation that fired the trigger SHALL stay observed: the gate skips the firing, it does not make the source report the same result again.

#### Scenario: Reason recorded

- **WHEN** a gate prints "no pull requests today"
- **THEN** the trigger's last firing shows skipped with the reason "gate: no pull requests today", and its health is unchanged

#### Scenario: Long output

- **WHEN** a gate prints 10 KiB of text
- **THEN** the firing's reason holds at most 512 bytes of it after the `gate: ` prefix

#### Scenario: Output contains a credential

- **WHEN** a gate's output contains one of the bot's credentials
- **THEN** the stored reason shows `[redacted]` in its place

#### Scenario: Redaction unavailable

- **WHEN** a gate prints text and the bot's credentials cannot be read to redact it
- **THEN** the firing is skipped with the reason `gate`

#### Scenario: No failure follow-up

- **WHEN** a gate skips a firing of a bot with Investigate failures on
- **THEN** no failure execution starts

#### Scenario: Gated once trigger

- **WHEN** a once trigger's gate prints "not needed"
- **THEN** the firing is recorded as skipped and the trigger is disabled

#### Scenario: Gated item is not reported again

- **WHEN** a command trigger that fires once per new item sees item 7, its gate skips the firing, and the next check still lists item 7
- **THEN** no further firing occurs for item 7

### Requirement: A broken gate fails open

A gate SHALL be *broken* for a firing when its run ends without a verdict for a reason other than cancellation: its file is missing or cannot be executed, it exits with a non-zero status and empty output, it exceeds its 30-second limit, its output is too large or is not UTF-8 text, or its run cannot be completed in the bot's container. A broken gate SHALL NOT skip the firing. The firing SHALL proceed to start its session under the ordinary rules, so a startup that then fails is recorded, retried and followed up exactly as for a trigger without a gate.

The session's first message SHALL carry, after the prompt, a note saying that the trigger's gate gave no verdict and the run started anyway. The session's bounded context block SHALL carry the gate's path, its exit status when the script ran to completion, and Terminay's reason when it did not. When the script ran to completion, the block SHALL also carry at most 1 KiB from the tail of its standard error, redacted with the bot's credentials before it is cut, and omitted if redaction is unavailable. The gate's path and error output SHALL be delivered only inside that block, as untrusted data. A broken gate SHALL NOT by itself change the trigger's health or start a failure follow-up.

#### Scenario: Missing script

- **WHEN** a trigger's gate names a file that does not exist and the trigger comes due
- **THEN** a session starts, its first message says the gate gave no verdict, and its context names the gate's path, a non-zero exit status and the error output

#### Scenario: Failing exit with no output

- **WHEN** a gate prints nothing to standard output, writes "token expired" to standard error and exits 2
- **THEN** a session starts whose context names exit status 2 and contains "token expired"

#### Scenario: Gate over its limit

- **WHEN** a gate is still running after 30 seconds
- **THEN** it is ended, and the session starts with a context reason saying the gate exceeded its time limit, without error output

#### Scenario: Credential in the gate's error output

- **WHEN** a broken gate's standard error contains one of the bot's credentials
- **THEN** the context shows `[redacted]` in its place

#### Scenario: Gate and startup both fail

- **WHEN** a gate cannot be run because the container engine is not running
- **THEN** the firing is recorded as failed with engine not running as the reason, as it would be without a gate

### Requirement: Gate field in the trigger editor

The trigger editor SHALL offer an optional Gate field for every source. It SHALL describe the gate in plain words: that it is a script in the bot's container run each time the trigger fires, that the run is skipped when the script prints any text and the text is kept as the reason, that the bot runs when it prints nothing, and that Run now ignores it. A saved trigger's gate SHALL be shown in the field when the trigger is edited, and clearing the field SHALL remove the gate.

#### Scenario: Adding a gate

- **WHEN** a user types `./check-new-pulls.sh` into the Gate field of a schedule trigger and saves
- **THEN** the trigger is saved with that gate, and reopening it shows the gate in the field

#### Scenario: Clearing a gate

- **WHEN** a user empties the Gate field of a gated trigger and saves
- **THEN** the trigger has no gate and its next firing starts a session without running a script

### Requirement: Runtime trigger tools explain the gate

The bot's runtime trigger tools SHALL read and write the gate under the same validation as the editor. The tools that create and replace a trigger SHALL describe the gate to the agent: what its output means, that a broken gate still starts the run, and that Run now bypasses it. They SHALL tell the agent to give a trigger a gate whenever a cheap check can tell that a run would have nothing to do, so that the trigger does not start wasteful AI sessions. The gate SHALL NOT be returned by the tools through which another bot inspects this one.

#### Scenario: Bot creates a gated trigger

- **WHEN** an execution calls `triggers_create` with a draft whose gate is `/home/bot/gates/new-pulls.sh`
- **THEN** the trigger is created with that gate, and `triggers_get` returns it

#### Scenario: Guidance in the tool

- **WHEN** an agent lists its runtime tools
- **THEN** the description of `triggers_create` tells it to add a gate when a cheap check can rule out a pointless run

#### Scenario: Invalid gate from a tool

- **WHEN** an execution calls `triggers_update` with a gate longer than 4096 bytes
- **THEN** the call is refused, naming the gate

#### Scenario: Another bot inspects the trigger

- **WHEN** a bot permitted to read other bots reads a gated trigger of another bot
- **THEN** the result does not contain the gate
