## MODIFIED Requirements

### Requirement: Scoped runtime MCP
Runtime tools SHALL be bound to a live server-authenticated bot and execution. They SHALL offer message list/search/get/post, execution list/get/post/stop/replace, a read of an execution's runner output and recent activity, incremental events, and management of the calling bot's triggers. They SHALL grant no project, terminal or host path authority, and no authority over another bot except the read-only inspection that the bot-inspection contract permits. Request/response sizes, waits and execution concurrency SHALL be bounded. Revoked or terminal executions SHALL not post or mutate state. Retry-safe mutations SHALL accept idempotency keys.

#### Scenario: Execution revoked
- **WHEN** a stopped execution retries a chat post
- **THEN** it is refused and no late user-facing success message appears

#### Scenario: Shell after revocation
- **WHEN** a replaced or stopped execution runs a shell command or desktop tool before its process group has ended
- **THEN** the command or tool is refused because the execution capability is no longer live

### Requirement: Runner output read
The runner output read SHALL accept any execution of the calling bot that has started, whether running, waiting on the user or ended. It SHALL return the stored, already-redacted runner output in slices of at most 6 KiB of text. Without a cursor it SHALL return the last slice, and its cursor SHALL continue towards earlier output. For an execution that has not ended it SHALL return only the latest slice, with no cursor, and SHALL refuse a supplied cursor as a conflict. It SHALL also return the time of the last recorded activity and the kind and status of at most the 10 latest activity entries, holding no title, command, plan text, tool input, tool output or message text. The whole response SHALL stay within the runtime response limit.

#### Scenario: Reading why an execution failed
- **WHEN** an execution reads the summary and then the runner output of a sibling execution that failed with `spawn EAGAIN`
- **THEN** the summary includes the failure reason, and the output read returns the end of the output, including the `EAGAIN` error, with a cursor for earlier output

#### Scenario: Running execution's output
- **WHEN** an execution asks for the runner output of an execution that is still running
- **THEN** it receives the latest redacted slice with no cursor, the time of the last activity, and the kind and status of the latest activity, without titles, commands, plan text, tool input, tool output or message text

#### Scenario: Cursor on a running execution

- **WHEN** an execution passes a cursor when reading a running execution's output
- **THEN** the request is refused as a conflict that tells it to read again without a cursor

#### Scenario: Another bot's output
- **WHEN** an execution asks for the runner output of an execution that belongs to another bot
- **THEN** the request is refused without revealing whether that execution exists
