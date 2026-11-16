## MODIFIED Requirements

### Requirement: Bounded context and paginated tools
Execution briefings SHALL contain bot instructions, trigger identity/content, bounded recent message excerpts, message counts, the number of other active executions (running or waiting on the user) with bounded summaries of them, the number of queued executions, and the bot's recent failures. MCP list/search tools SHALL default to 10 items, cap at 25 items and 8 KiB of response data, and return opaque scope-bound cursors and explicit truncation. Message bodies, execution transcripts and attachments SHALL NOT be expanded by list tools. Detail reads SHALL support bounded continuation. Snapshot pagination SHALL not duplicate records when new messages arrive.

#### Scenario: Large history
- **WHEN** an execution starts with thousands of messages and long bodies
- **THEN** it receives a bounded briefing and uses cursors or explicit detail reads for more context

#### Scenario: Cursor misuse
- **WHEN** a cursor is invalid or belongs to another bot, query, revision or snapshot
- **THEN** the request is refused without revealing that other scope

#### Scenario: Other executions are running
- **WHEN** an execution starts while one other execution of the same bot is running
- **THEN** its briefing states that one other execution is active, summarises it, and asks the agent to decide whether to stop it, steer it, replace it or leave it running

#### Scenario: Queued work is not counted as active
- **WHEN** an execution starts while two executions are running, one is revoked and ending, and six are queued
- **THEN** its briefing reports two active executions, summarises only those two, and reports six queued executions

### Requirement: Scoped runtime MCP
Runtime tools SHALL be bound to a live server-authenticated bot and execution. They SHALL offer message list/search/get/post, execution list/get/post/stop/replace, a read of an ended execution's runner output, incremental events, and management of the calling bot's triggers. They SHALL grant no project, terminal, host path or other bot authority. Request/response sizes, waits and execution concurrency SHALL be bounded. Revoked or terminal executions SHALL not post or mutate state. Retry-safe mutations SHALL accept idempotency keys.

#### Scenario: Execution revoked
- **WHEN** a stopped execution retries a chat post
- **THEN** it is refused and no late user-facing success message appears

#### Scenario: Shell after revocation
- **WHEN** a replaced or stopped execution runs a shell command or desktop tool before its process group has ended
- **THEN** the command or tool is refused because the execution capability is no longer live

### Requirement: Scoped trigger management
A live execution SHALL be able to list/search, read, create, update, delete, enable/disable, preview and run its own bot's triggers through runtime tools. The server SHALL derive bot ownership from the execution capability. All writes SHALL require the observed server revision and refuse stale or repeated requests before changing state or launching work. The existing trigger service SHALL enforce schedule/event validation, time zone, minimum interval, trigger count and pending-firing cancellation. Run now SHALL start an independent execution.

Lists SHALL return bounded metadata without prompts, with scope/filter/revision-bound continuation and change-event cursors. Prompt detail SHALL use explicit bounded UTF-8-safe slices, with continuation invalidated by content changes. Trigger configuration changes SHALL emit bounded incremental events without prompt bodies, including changes made through the UI.

#### Scenario: Bot creates and changes a schedule
- **WHEN** a live bot execution creates a valid trigger and later reads and updates it with the current revision
- **THEN** the same persisted trigger appears in Configure, and the scheduler follows the revised definition

#### Scenario: Stale creation or Run now retry
- **WHEN** a tool request reuses a server revision after an earlier mutation succeeded
- **THEN** it fails with a conflict and creates no duplicate trigger or execution

#### Scenario: Trigger ownership and revocation
- **WHEN** an execution targets another bot's trigger or uses a revoked capability
- **THEN** the request is refused without changing either bot

#### Scenario: Large prompt and configuration changes
- **WHEN** an execution reads a trigger with a large prompt or follows a cursor after its configuration changes
- **THEN** prompt reads stay within the response budget, and stale continuation requires a fresh read

### Requirement: Corrections and replacement
A new execution SHALL be able to inspect other active executions, deliver a durable bounded inbox message or replace older work. Inbox delivery SHALL distinguish accepted from consumed. Replacement SHALL check an expected target revision, record supersession, revoke old mutation authority, including its shell and desktop gate, and await process cleanup. A target already completed SHALL be reported explicitly. External effects already performed SHALL not be represented as undone.

#### Scenario: Correct destination
- **WHEN** a new execution interprets “BBC Sports instead” as a correction to an active BBC News execution
- **THEN** it can stop/supersede that execution and post the corrected result without a late post from the old execution

### Requirement: Shared resources and admission
Fresh message executions SHALL not wait behind a single per-bot conversation turn. Normal concurrency SHALL be bounded with reserved coordination capacity. Every live execution SHALL be able to use the shared shell and desktop at the same time as the bot's other live executions; the server SHALL NOT grant exclusive ownership of either. Executions SHALL coordinate overlapping work through the runtime coordination tools. The execution briefing SHALL tell the agent that the desktop and browser are shared, that it must not drive them while another active execution is using them, and that it should re-check active executions with the runtime tools before taking the desktop, because the briefing is a startup snapshot. Two executions that start together MAY still race; the server SHALL NOT resolve that race with an exclusive lease. Process groups and credentials SHALL remain execution-scoped; sibling executions share the bot container and are not security-isolated from one another.

#### Scenario: Busy desktop
- **WHEN** an execution is using the desktop and a correction arrives
- **THEN** the correction execution can inspect it and stop, message or replace it, and has shell and desktop access of its own

#### Scenario: Desktop tools through the shell prefix
- **WHEN** an agent launches the desktop or browser MCP server through the bot's shell prefix and calls a tool while its execution is live
- **THEN** the call reaches the desktop, the server it wraps does not inherit the runtime token, and the same call is refused once the execution is revoked

#### Scenario: Briefing warns about the shared desktop
- **WHEN** an execution starts while another execution is active
- **THEN** its briefing warns not to drive the desktop or browser while another active execution uses them and to re-check active executions before doing so

#### Scenario: A refused command does not break later commands
- **WHEN** an execution's shell command is refused and the execution then runs further commands while its capability is live
- **THEN** those later commands run, and none fails because an earlier command stripped its runtime token
