## MODIFIED Requirements

### Requirement: Bounded context and paginated tools
Execution briefings SHALL contain bot instructions, trigger identity/content, bounded recent message excerpts, message counts, bounded active execution summaries, and the bot's recent failures. MCP list/search tools SHALL default to 10 items, cap at 25 items and 8 KiB of response data, and return opaque scope-bound cursors and explicit truncation. Message bodies, execution transcripts and attachments SHALL NOT be expanded by list tools. Detail reads SHALL support bounded continuation. Snapshot pagination SHALL not duplicate records when new messages arrive.

#### Scenario: Large history
- **WHEN** an execution starts with thousands of messages and long bodies
- **THEN** it receives a bounded briefing and uses cursors or explicit detail reads for more context

#### Scenario: Cursor misuse
- **WHEN** a cursor is invalid or belongs to another bot, query, revision or snapshot
- **THEN** the request is refused without revealing that other scope

### Requirement: Scoped runtime MCP
Runtime tools SHALL be bound to a live server-authenticated bot and execution. They SHALL offer message list/search/get/post, execution list/get/post/stop/replace, a read of an ended execution's runner output, incremental events, management of the calling bot's triggers and shared-work coordination. They SHALL grant no project, terminal, host path or other bot authority. Request/response sizes, waits and execution concurrency SHALL be bounded. Revoked or terminal executions SHALL not post or mutate state. Retry-safe mutations SHALL accept idempotency keys.

#### Scenario: Execution revoked
- **WHEN** a stopped execution retries a chat post
- **THEN** it is refused and no late user-facing success message appears

## ADDED Requirements

### Requirement: Briefings report recent failures
A briefing SHALL list up to 5 of the bot's executions that ended as failed or timed out in the last 24 hours, each with its compact origin and failure reason cut to 256 bytes. It SHALL also list up to 5 of the bot's triggers whose condition health is failed or blocked, each with its health error cut to 256 bytes.

#### Scenario: Briefing after failures
- **WHEN** a chat execution starts an hour after a trigger execution failed and while that trigger's condition check is failing
- **THEN** its briefing lists the failed execution with its reason and the trigger with its health error

### Requirement: Briefings trim in a fixed order
When a briefing exceeds its budget, it SHALL drop entries in this order until it fits: older recent messages, then unhealthy triggers, then failed executions, then other active executions. Trigger identity and content SHALL always be kept.

#### Scenario: Worst-case failure text
- **WHEN** ten failed executions and ten failing triggers all have 1 KiB reasons of multibyte and JSON-escaped characters
- **THEN** the briefing stays within its budget and lists at most five of each, cut on UTF-8 boundaries

### Requirement: Execution failure details
Execution list results SHALL carry a compact origin: its kind, any trigger ID and name, and for a failure origin the number of failures. They SHALL also carry the failure reason cut to 256 bytes and the structured failure cause. A single execution read SHALL add the reason cut to 1 KiB and, for a failure origin, its listed failures, within the 8 KiB response budget.

#### Scenario: Failure origin detail
- **WHEN** an execution reads a failure execution that lists 20 failures with 1 KiB reasons
- **THEN** the response stays within 8 KiB and says how many failures were left out

### Requirement: Runner output read
The runner output read SHALL accept only ended executions of the calling bot. It SHALL return the stored, already-redacted runner output in slices of at most 6 KiB of text. Without a cursor it SHALL return the last slice, and its cursor SHALL continue towards earlier output.

#### Scenario: Reading why an execution failed
- **WHEN** an execution reads the summary and then the runner output of a sibling execution that failed with `spawn EAGAIN`
- **THEN** the summary includes the failure reason, and the output read returns the end of the output, including the `EAGAIN` error, with a cursor for earlier output

#### Scenario: Running execution's output
- **WHEN** an execution asks for the runner output of an execution that is still running
- **THEN** the request is refused as a conflict that says the execution has not ended

#### Scenario: Another bot's output
- **WHEN** an execution asks for the runner output of an execution that belongs to another bot
- **THEN** the request is refused without revealing whether that execution exists
