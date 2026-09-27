## MODIFIED Requirements

### Requirement: Automation definition

An automation SHALL have a name, an enabled state, exactly one trigger, exactly one action, and its run settings: keep terminal after run, record session, loop-guard cooldown, and keep history. A disabled automation SHALL NEVER fire on its trigger. Saving an automation SHALL validate its trigger and action together and SHALL refuse a combination the action cannot serve, naming the reason. Edits SHALL apply to runs that start after the edit and SHALL NOT change a run already in progress.

#### Scenario: Disabled automation

- **WHEN** a disabled automation's trigger occurs
- **THEN** no run starts and no run is logged

#### Scenario: Invalid combination

- **WHEN** a user saves a scheduled automation whose action writes text to the subject terminal
- **THEN** the save is refused with a reason saying scheduled triggers have no subject terminal

#### Scenario: Edit during a run

- **WHEN** an automation is edited while one of its runs is in progress
- **THEN** that run continues under the definition it started with

### Requirement: Run log

The server SHALL keep a bounded log of automation runs, retaining at most the most recent 100 runs per automation and dropping the oldest first, less any runs a user has deleted or pruned and any runs outside the automation's keep-history period. Each entry SHALL record the automation, the trigger kind and fire time, the subject, whether it was started by a trigger, by a user, or by an agent through MCP, the outcome — succeeded, failed with exit code, timed out, stopped, or skipped with a reason — the duration, and a bounded tail of the run terminal's final output. The log SHALL be server-owned, SHALL survive restart, and SHALL be available to clients that have authority over automations.

#### Scenario: Output tail after the terminal closed

- **WHEN** a user opens a finished run whose terminal has closed
- **THEN** the run's outcome, exit code, duration, and final output tail are shown

#### Scenario: Log bound

- **WHEN** an automation has run 150 times and none of its runs have been deleted, pruned, or aged out
- **THEN** its oldest runs are dropped and its latest 100 remain

#### Scenario: Run started by an agent

- **WHEN** an agent starts a run with `run_automation`
- **THEN** the run is logged as started by an agent through MCP

## ADDED Requirements

### Requirement: Deleting and pruning runs

A user with authority over automations SHALL be able to delete a single finished run from an automation's run log, and to prune an automation's run log by removing every finished run that started more than a chosen number of whole days ago, where zero days removes every finished run. A run still in progress SHALL NEVER be deleted or pruned: deleting one SHALL be refused, and pruning SHALL leave it in place. Deleting a run that does not exist SHALL be refused. Deleted and pruned runs SHALL be removed from the server's stored log and SHALL NOT come back after restart. Each deletion and prune SHALL be audited with the acting client and the number of runs removed. When runs are removed, the server SHALL publish an event naming only the automation and the removed run ids, so that other clients refresh. Deleting or pruning runs SHALL NOT change the automation's definition or its revision.

#### Scenario: Deleting one run

- **WHEN** a user deletes a finished run
- **THEN** that run is gone from the automation's history on every client, and its other runs remain

#### Scenario: Deleting a running run

- **WHEN** a user tries to delete a run that is still in progress
- **THEN** the request is refused and the run continues and stays in the log

#### Scenario: Pruning old runs

- **WHEN** an automation has finished runs from 2, 10, and 40 days ago and a user prunes runs older than 7 days
- **THEN** the runs from 10 and 40 days ago are removed and the run from 2 days ago remains

#### Scenario: Pruning everything

- **WHEN** a user prunes an automation's runs older than 0 days while one of its runs is in progress
- **THEN** every finished run is removed and the run in progress remains

#### Scenario: Pruned runs stay gone

- **WHEN** a user prunes runs and the server then restarts
- **THEN** the pruned runs are still absent from the log

### Requirement: Remembered prune choice

The server SHALL remember, for each automation, the number of days a user last submitted in a prune of that automation's runs, SHALL return it with that automation's run log, and SHALL keep it across restart. The remembered choice SHALL be shared by every client of the server and SHALL NOT change the automation's definition or its revision. An automation that has never been pruned SHALL have no remembered choice.

#### Scenario: Choice shared across clients

- **WHEN** a user prunes an automation's runs older than 14 days on one client and then opens that automation's Prune form on another client
- **THEN** the form is pre-filled with 14 days

### Requirement: Run history retention

An automation's keep-history setting SHALL be either off, which is the default, or a whole number of days from 1 to 3650. When it is set, the server SHALL treat every finished run that started more than that many days ago as removed: such a run SHALL NEVER be returned in the automation's run log to any client or MCP caller. The server SHALL remove such runs from its stored log no later than the next change to the run log, the next read of it, or the next restart, whichever comes first, and SHALL NOT use a recurring timer to do so. A run still in progress SHALL NEVER be removed by retention. Shortening the setting SHALL apply to existing runs as soon as the automation is saved. Turning the setting off SHALL NOT restore runs that have already been removed.

#### Scenario: Old runs age out

- **WHEN** an automation keeps history for 7 days and one of its finished runs started 8 days ago
- **THEN** that run is absent from its run history on every client

#### Scenario: Setting shortened

- **WHEN** a user changes an automation from keeping history for 30 days to 1 day and saves it
- **THEN** its finished runs that started more than 1 day ago are no longer listed

#### Scenario: Retention off by default

- **WHEN** a user creates an automation without choosing a keep-history period
- **THEN** its runs are removed only by the 100-run bound or by a user deleting or pruning them

### Requirement: Run history controls

In the Automations section, an automation's run history SHALL offer a Delete control on each finished run and a Prune control for the whole history. Delete SHALL remove the run without asking for confirmation. Prune SHALL always open a form that asks how many days of history to keep, where 0 means remove every finished run. The form SHALL be pre-filled with the automation's remembered prune choice, or with 30 days when there is none, and SHALL be editable before it is submitted. The form SHALL state how many finished runs the prune will remove, and SHALL require confirmation before it removes any. The automation editor SHALL offer the keep-history setting as "Keep history for N days", empty meaning off.

#### Scenario: Prune form remembers the last choice

- **WHEN** a user prunes an automation's runs older than 3 days and later opens its Prune form again
- **THEN** the form opens pre-filled with 3 days, and the user can change the value before confirming

#### Scenario: Prune form shows the count

- **WHEN** a user enters 7 days in the Prune form of an automation that has 5 finished runs older than 7 days
- **THEN** the form says 5 runs will be removed, and nothing is removed until the user confirms

#### Scenario: Deleting a run from the history

- **WHEN** a user presses Delete on a finished run in the run history
- **THEN** the run is removed at once without a confirmation prompt
