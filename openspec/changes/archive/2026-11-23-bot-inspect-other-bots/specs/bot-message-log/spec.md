## MODIFIED Requirements

### Requirement: Scoped runtime MCP
Runtime tools SHALL be bound to a live server-authenticated bot and execution. They SHALL offer message list/search/get/post, execution list/get/post/stop/replace, a read of an ended execution's runner output, incremental events, and management of the calling bot's triggers. They SHALL grant no project, terminal or host path authority, and no authority over another bot except the read-only inspection that the bot-inspection contract permits. Request/response sizes, waits and execution concurrency SHALL be bounded. Revoked or terminal executions SHALL not post or mutate state. Retry-safe mutations SHALL accept idempotency keys.

#### Scenario: Execution revoked
- **WHEN** a stopped execution retries a chat post
- **THEN** it is refused and no late user-facing success message appears

#### Scenario: Shell after revocation
- **WHEN** a replaced or stopped execution runs a shell command or desktop tool before its process group has ended
- **THEN** the command or tool is refused because the execution capability is no longer live
