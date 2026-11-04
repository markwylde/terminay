## MODIFIED Requirements

### Requirement: Bot trigger definition

The bot SHALL be able to manage its own triggers through authenticated runtime tools as specified by bot-message-log. Agent operations SHALL use the same validation, persistence, source execution and scheduler as the user interface, and SHALL not grant access to another bot's triggers. Definitions SHALL be generic; Terminay SHALL NOT interpret forge, repository, pull-request or CLI-specific semantics.

A bot SHALL have at most 50 triggers. Each trigger SHALL have a name, an enabled state, exactly one source definition, a missed-run policy, and a nonempty prompt of at most 32 KiB of UTF-8. Its source SHALL be a time schedule, file/folder watch, outbound SSE subscription, periodic HTTP request, or periodic command. An empty prompt SHALL be refused on save, naming the prompt. Triggers SHALL belong to their bot alone and SHALL be removed with it.

A firing SHALL start a new session of its bot, with the prompt as its first message followed by a bounded, labelled event context block. New-item observations SHALL produce one event and independent session per item. Context SHALL carry the stable event ID, trigger identity, source kind, observed time, original due time where applicable, recovery provenance and selected payload. Source data SHALL be presented as untrusted data, never interpreted as a command or prompt template. Context SHALL contain no runtime capability, injected credential, request authentication header or unrelated bot/project state. A disabled trigger or disabled bot SHALL never fire automatically. Edits SHALL apply to future observations; accepted events SHALL retain their definition snapshot.

#### Scenario: Trigger starts a session

- **WHEN** a trigger with the prompt "Check the nightly build and summarise failures" fires while its bot has capacity
- **THEN** a new session starts with that prompt and labelled event context

#### Scenario: Generic item source

- **WHEN** a bot configures a command that returns three previously unseen JSON items
- **THEN** each item produces its own event and session without Terminay knowing what the items represent

#### Scenario: Disabled trigger

- **WHEN** a disabled trigger's schedule comes due
- **THEN** no source check or automatic session starts

### Requirement: Schedule triggers

A time trigger SHALL be once at a date and time, every N elapsed minutes where N is at least 1, or a standard five-field cron expression. The editor SHALL describe it in plain words and preview its next five firings before saving. Unparseable schedules, schedules that never match, and intervals below 60,000 ms SHALL be refused. Periodic HTTP and command sources SHALL also accept intervals of at least 60,000 ms, independently of automation interval validation.

#### Scenario: Weekday cron

- **WHEN** a user chooses weekdays at 09:00
- **THEN** the schedule is `0 9 * * 1-5`, is described as every weekday at 09:00, and previews the next five firings

#### Scenario: One-minute check

- **WHEN** a bot saves a periodic command with interval 60,000 ms
- **THEN** the interval is accepted

#### Scenario: Interval too short

- **WHEN** a user saves a time, HTTP or command interval of 30,000 ms
- **THEN** the save is refused, naming the one-minute minimum

### Requirement: Schedule semantics

Cron schedules SHALL use the same parser, presets, server-local time zone, daylight-saving rules and one-minute resolution as automation schedules. Every schedules and periodic checks SHALL be anchored when created or explicitly enabled, measured in elapsed time and restored across restart. Editing only name, prompt or display metadata SHALL not reset the anchor or observation memory. Source or condition edits SHALL establish a new observation generation and explicitly show the memory reset before user save. A once trigger SHALL be disabled after its occurrence is durably accepted or deliberately skipped under its missed-run policy. Recovery SHALL not shift the next regular due time.

#### Scenario: Interval across a restart

- **WHEN** an every-6-hours trigger is anchored at 08:00 and the server restarts at 12:00
- **THEN** its next regular firing is 14:00

#### Scenario: Interval across daylight saving

- **WHEN** an every-1-hour trigger runs across the night the clocks go back
- **THEN** it fires once every 60 elapsed minutes

#### Scenario: Prompt edit

- **WHEN** a user edits only the prompt of a command trigger with remembered items
- **THEN** its anchor and remembered item identities remain unchanged

### Requirement: Event triggers

An event trigger SHALL observe only its configured source inside the owning bot's container. Paths and working directories SHALL refer to that container; URLs SHALL be resolved and accessed from that container. Commands SHALL run as its unprivileged bot user with its configured environment and credentials. Source execution SHALL not use the Terminay Server account's shell, filesystem watches, credential discovery, HTTP client or project event feed. It SHALL create no inbound listener, publish no container port and require no desktop/browser client connection.

All workers SHALL be bounded, lifecycle-owned and cancellable independently of AI sessions. A source failure SHALL update source health without starting an AI session or advancing successful-observation state. The server SHALL reject stale worker results after an edit, disable, deletion or replacement. Container engine authority already available to the bot SHALL not be widened by the trigger API.

#### Scenario: Container path

- **WHEN** a file trigger watches `/tmp/example`
- **THEN** it watches that path in its owning bot container and does not watch the server host's `/tmp/example`

#### Scenario: Remote server without a client

- **WHEN** every client disconnects from a running remote Terminay Server
- **THEN** enabled triggers continue observing and dispatching on that server

#### Scenario: No sensitive context

- **WHEN** an event trigger's session starts
- **THEN** its context contains only its bounded selected source data and metadata, with no injected token or request authentication headers

### Requirement: Busy, overlapping, and missed firings

Distinct events from one trigger SHALL be allowed to wait concurrently and SHALL enter the bot's existing bounded work admission; the reserved user-message coordination slot SHALL remain reserved. Each accepted event SHALL have a durable identity and at most one automatically created session. Queue saturation SHALL defer a durably retained event rather than mark it seen and discard it. The server SHALL retain at most 1,000 pending trigger events or 16 MiB of pending context per bot, whichever is reached first, and SHALL stop accepting further observations on exhaustion, visibly mark the affected source blocked and report the recovery limitation. It SHALL never silently evict pending events or remembered identities.

Disabling or deleting a trigger SHALL cancel its undelivered pending events, record why and stop its source. Disabling a bot SHALL pause source checks and dispatch without deleting retained events. An accepted event whose session has started SHALL not be automatically replayed after failure or restart; its interrupted/failed session SHALL remain inspectable for explicit retry. Start failures SHALL name the cause, including engine unavailable, agent not ready or image build failure. Missed occurrences SHALL follow the trigger's recovery policy and remain distinguishable from failed checks and interrupted sessions.

#### Scenario: Bot busy

- **WHEN** a trigger emits two new item events while work capacity is full
- **THEN** both wait durably and later start separate sessions as capacity becomes available

#### Scenario: Pending event survives restart

- **WHEN** the server restarts after accepting an event but before creating its session
- **THEN** it resumes dispatch of the same event ID without creating a duplicate event

#### Scenario: Saturation

- **WHEN** a source produces more events than the pending-event limits permit
- **THEN** the unaccepted observation does not advance its checkpoint, source health shows blocked, and no pending event is silently discarded

#### Scenario: Engine unavailable

- **WHEN** a source cannot run because the container engine is unavailable
- **THEN** its health names that failure and its last successful observation remains intact

### Requirement: Triggers tab

The Triggers tab SHALL use available panel width with standard padding and show a source-grouped list alongside the selected trigger's editor. On narrow clients it SHALL show the list or editor with a back action preserving the unsaved draft. Creating and editing SHALL not require a modal. The source picker SHALL have two levels: Files / file or folder changes; Network / SSE event or HTTP response; Commands / command result; Time / schedule, interval or once. The command result's condition SHALL be selected within its editor.

Each row SHALL show name, source, enabled state, health and a useful last-check or connection summary, independently of last firing and last session outcome. The editor SHALL expose source-specific fields, prompt, recovery policy, first-observation behaviour where relevant, remembered-state summary, reset with confirmation, bounded diagnostic results and a Test source action. It SHALL state that source execution happens in the bot's container and when continuous watching prevents idle shutdown. Secrets SHALL remain masked. Invalid settings SHALL identify the field.

Each trigger SHALL offer edit, enable/disable, delete and Run now. Run now on a time trigger SHALL enqueue a manual session even when that trigger is disabled; on an observation source it SHALL perform one real check and apply its condition, recording manual origin for any accepted events. It SHALL not fabricate file/SSE events. A disabled bot SHALL reject Run now with an Enable action. Test source SHALL be separate from Run now.

The tab SHALL show upcoming scheduled firings/checks in time order for seven days, labelled as checks where conditional. The context rail SHALL show the next three. Continuous sources SHALL show connection/watch state rather than invented firing dates.

#### Scenario: Wide bot panel

- **WHEN** a user opens Triggers in a wide bot panel and selects a trigger
- **THEN** the grouped list and editor share the available width with no modal

#### Scenario: Conditional check

- **WHEN** a command checks successfully and finds nothing new
- **THEN** last checked updates, last fired stays unchanged, and no AI session starts

#### Scenario: Run now

- **WHEN** a user chooses Run now on a disabled time trigger whose bot is enabled
- **THEN** a session with manual origin starts and the trigger stays disabled

#### Scenario: Upcoming firings

- **WHEN** a bot has an hourly time trigger and a minute-based HTTP check
- **THEN** the upcoming list interleaves their due times and distinguishes checks from unconditional sessions

### Requirement: Automations keep their behaviour on the shared scheduler

Automations and bot time schedules SHALL share the schedule engine. Bot source observation SHALL be independent of project automation event fan-out. Every automation requirement SHALL hold unchanged, including its event inventory, interval validation, queueing, missed-run policy and run log. Bot source changes SHALL not add project-event subscriptions or alter automation behaviour.

#### Scenario: Automation unaffected

- **WHEN** a bot check and an automation are both due in the same minute
- **THEN** each follows its own policy and the automation's run log is the same as it would be with no bots present

## ADDED Requirements

### Requirement: Filesystem observations

A file source SHALL accept an absolute container path naming a file or directory, recursive selection for directories, optional include/exclude patterns and a debounce in milliseconds, default 5,000. It SHALL observe create, content change, rename and delete using filesystem events inside its bot container, with no periodic scan fallback.

#### Scenario: Container path

- **WHEN** a trigger watches `/tmp/example`
- **THEN** it observes that container path and never the server host's path

### Requirement: Filesystem burst handling

Debounce SHALL coalesce matching changes into bounded event context after quiet, with a maximum 30-second wait under continuous changes.

#### Scenario: Burst of writes

- **WHEN** matching files change continuously within the debounce window
- **THEN** one event describes coalesced changes by the maximum wait, without one session per low-level notification

### Requirement: Filesystem watch establishment

Missing targets SHALL be reported as waiting and observed through an existing ancestor so creation can establish the target watch. Recursive traversal SHALL not follow symbolic links and SHALL enforce explicit watcher/snapshot limits. Watch failure SHALL be visible without polling fallback.

#### Scenario: Missing target

- **WHEN** a configured missing path is created
- **THEN** its source establishes the target watch without a polling loop

### Requirement: Outbound SSE observations

An SSE source SHALL accept an HTTP(S) URL, headers and optional event-name filter, connect outward from the bot container, and emit one event per matching message. It SHALL parse fragmented UTF-8, multiline data, comments and event IDs. Comments SHALL be keepalives rather than firings.

#### Scenario: SSE keepalive

- **WHEN** a stream sends only comment lines
- **THEN** the connection stays healthy and no session starts

### Requirement: SSE cursor recovery

The source SHALL persist a cursor only with durable event acceptance. Recover mode SHALL send the saved Last-Event-ID; ignore mode SHALL reconnect without requesting replay and record the gap. Replayed identified messages SHALL not create duplicate sessions.

#### Scenario: SSE reconnect

- **WHEN** recover mode reconnects after accepting SSE event ID `42`
- **THEN** it requests continuation with Last-Event-ID `42` and suppresses already accepted identified messages

### Requirement: SSE recovery limitations

Absence of cursor or replay support SHALL be shown as unavailable recovery, never proof that every event was recovered. Unidentified messages SHALL be explicitly described as lacking replay deduplication.

#### Scenario: No source IDs

- **WHEN** an SSE stream emits messages without IDs and disconnects
- **THEN** health exposes that replay recovery and deduplication cannot be guaranteed

### Requirement: HTTP observations

An HTTP source SHALL accept an HTTP(S) URL, headers, interval and optional JSON Pointer selecting a response value. It SHALL perform GET requests inside the bot container with timeout and byte limits. It SHALL compare the selected value or body bytes by default, excluding response headers. Selected JSON object key order SHALL not count as a change.

#### Scenario: Selected status unchanged

- **WHEN** selected `/status` is unchanged while another response field changes
- **THEN** the check succeeds without firing

### Requirement: HTTP successful comparison state

A first successful changed-value check SHALL establish a baseline without firing. HTTP 304 SHALL preserve comparison state. Non-success responses, timeout, invalid JSON or missing selected values SHALL fail without establishing a new baseline.

#### Scenario: Failed response

- **WHEN** a previously successful endpoint returns HTTP 500
- **THEN** health reports a failed check and retains prior comparison state

### Requirement: Command observations and generic conditions

A command source SHALL accept a shell script, absolute container working directory default `/home/bot`, interval and timeout. It SHALL run in the non-interactive container shell as bot under supervised cleanup, without interpolating event data into the script. It SHALL capture stdout, stderr and exit separately.

#### Scenario: Command environment

- **WHEN** a command checks an installed CLI
- **THEN** it uses the bot container user, directory, environment and credentials without a host fallback

### Requirement: Command condition modes

Command conditions SHALL include stdout changed, literal contains, bounded regex, exit code equals and new JSON items. Text/exit conditions SHALL offer became-matching (default) and every-matching-check. An initially matching successful check SHALL fire; first changed-output checks SHALL only establish a baseline.

#### Scenario: Match becomes true

- **WHEN** stdout first matches and remains matching on the next check in became-matching mode
- **THEN** only the first check fires

### Requirement: Command check failures and cleanup

A nonzero command exit SHALL fail unless exit-code matching is selected. Empty assertions, invalid patterns, invalid JSON and oversized/truncated results SHALL fail without advancing memory. Matching SHALL be bounded in input and cost. Checks of one trigger SHALL never overlap; timed-out processes SHALL be cleaned up before another begins.

#### Scenario: Failed command

- **WHEN** a changed-output command exits nonzero with error text
- **THEN** the check fails rather than treating stderr as changed successful output

### Requirement: New-item observation memory

HTTP and command sources SHALL support JSON Pointers selecting an array and a nonempty string or finite number ID within each item. IDs SHALL be scoped to trigger and generation. Invalid selections, duplicate identities or oversized items SHALL fail the whole observation without advancing memory.

#### Scenario: Duplicate IDs

- **WHEN** a response contains two items with the same selected ID
- **THEN** validation fails and neither events nor memory advance

### Requirement: First and repeated item observations

First observation SHALL offer process-existing (default) or baseline-only. Each newly accepted identity SHALL produce one event and remain remembered across absence, updates, reappearance and restarts. Changing item identity semantics SHALL require an explicit memory reset.

#### Scenario: Existing items included

- **WHEN** a new item trigger uses defaults and first receives two items
- **THEN** both are accepted separately and remembered

### Requirement: Item memory bounds and reset

Memory SHALL be capped at 100,000 IDs per trigger and 16 MiB per bot. Exhaustion SHALL visibly block acceptance without evicting identities. Paginated metadata inspection and reset SHALL be available; reset SHALL warn about reprocessing. External pagination SHALL be the configured script’s responsibility, without provider-specific assumptions.

#### Scenario: Item reappears

- **WHEN** an accepted ID disappears and later returns with edited content
- **THEN** no second new-item event is accepted for that ID

### Requirement: Per-trigger downtime recovery

Time, periodic command and HTTP triggers SHALL offer skip, run-once-on-return and replay-missed-occurrences. Time SHALL default to skip; periodic observations SHALL default to run once. Recovery SHALL use server-persisted due/evaluation state across restart and suspension, independent of clients, retaining time-zone and anchor semantics.

#### Scenario: Laptop resumes with skip

- **WHEN** the server resumes after sixty missed command checks with skip policy
- **THEN** it records sixty missed checks, runs no catch-up check and preserves the next regular due time

### Requirement: Coalesced recovery

Skip SHALL record missed count/range and resume at the next regular due time. Run-once SHALL create at most one recovered occurrence/check carrying the missed range. Once schedules SHALL apply their selected policy to their single occurrence. Recovery SHALL not automatically retry sessions already started.

#### Scenario: Laptop resumes with run once

- **WHEN** the server resumes after sixty missed checks with run-once policy
- **THEN** one current check runs with the missed range in recovery context

### Requirement: Bounded replay recovery

Replay SHALL enumerate original due times oldest first with a durable cursor and admission bounds, never allocate the entire backlog at startup. Periodic replay SHALL execute current checks labelled with historical due times; the editor SHALL explain these do not reconstruct historical results. Restart SHALL not duplicate accepted occurrences.

#### Scenario: Replay interrupted

- **WHEN** replay has accepted three of ten missed time occurrences before restart
- **THEN** it resumes at the fourth without duplicate sessions for the accepted three

### Requirement: Continuous source gap recovery

File/SSE triggers SHALL offer ignore-gap or recover-available. Recover SHALL rescan file snapshots or request SSE continuation; ignore SHALL establish a fresh baseline/cursor without firing for the gap. File rescan SHALL report net differences, not intermediate history. Unknown/unrecoverable gaps SHALL remain visible.

#### Scenario: File gap

- **WHEN** a file is created and deleted entirely while watching is unavailable
- **THEN** rescan does not claim to observe that transient file and reports the recovery limitation

### Requirement: Explicit pause recovery boundary

Explicitly disabled bot/trigger periods SHALL be excluded from missed-run accounting. Re-enable SHALL establish a new observation boundary without replaying activity during that period, while retaining prior remembered identities. Brand-new source first-observation settings SHALL remain distinct from this resume boundary.

#### Scenario: Explicit disable

- **WHEN** a trigger is disabled for an hour and re-enabled
- **THEN** that hour generates no missed-run replay and current observation state establishes a boundary without disabled-period events

### Requirement: Source testing and health

UI and same-bot tools SHALL test unsaved source definitions using shared validation and bounds. Tests SHALL execute a command/request or observe files/SSE for a bounded window and return diagnostics, parsed values and would-fire results. They SHALL be cancellable and invalidated after draft changes.

#### Scenario: Agent tests another bot

- **WHEN** a bot runtime requests another bot’s test or memory
- **THEN** it is refused without executing or exposing the source

### Requirement: Source test isolation

Testing SHALL never start an AI session or mutate live memory, cursor, schedule anchor or accepted events. The UI SHALL state that testing executes the configured command/request and can have external side effects.

#### Scenario: Test discovers an item

- **WHEN** a test finds a new item
- **THEN** it previews would-fire without remembering the item or starting a session, allowing the next live check to accept it

### Requirement: Source health reporting

Health SHALL distinguish disabled, watching/connected, waiting for path, checking, healthy, retrying, blocked and failed. It SHALL expose last success, last attempt, last firing, next check/retry, gap and bounded redacted errors. Retry/reconnect SHALL be bounded with terminal failure and Retry action. No extra health-sampling poll SHALL exist.

#### Scenario: Check without firing

- **WHEN** a successful command check finds no new item
- **THEN** last checked updates independently of last fired and no AI session starts
