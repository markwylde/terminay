## ADDED Requirements

### Requirement: Native CLI executions are host-owned and bot-scoped

The server SHALL run native CLI executions inside their owning bot container as `bot` in `/home/bot`, under its session supervisor. Installed extensions SHALL supply validated agent/model selections, not host paths, arbitrary engine arguments or remote runners. Each execution SHALL record its driver and runtime version and emit bounded normalized diagnostics, tool activity, permissions and outcomes.

#### Scenario: Execution starts

- **WHEN** a signed-in bot receives a user message or trigger
- **THEN** a fresh native CLI execution starts inside its own container with its snapshotted agent, model, instructions and bounded briefing

#### Scenario: Unsupported driver

- **WHEN** a contribution names a driver the server does not implement
- **THEN** it is rejected with an actionable compatibility reason and no process starts

### Requirement: Communication and coordination remain independent of CLI output

Only explicit execution-scoped chat posts SHALL create bot replies. Native stdout, stderr, final answers, thoughts and tools SHALL be diagnostic records, subject to the existing transcript/output storage limits and chunk-safe credential redaction. Concurrent admission, work ownership, revision-checked replacement, revocation and bounded runtime tools SHALL follow the bot message-log contract. A CLI final answer SHALL NOT implicitly post a message or start another execution.

#### Scenario: CLI prints a final answer

- **WHEN** an execution emits an answer without invoking chat posting
- **THEN** the answer appears in execution diagnostics and the shared message log receives no bot reply

#### Scenario: Replaced execution posts late

- **WHEN** a replaced execution attempts a chat post or a desktop action
- **THEN** its revoked capability is refused before the action takes effect

### Requirement: Credentials stay with their owning bot

Native drivers SHALL use only the bot's selected sign-in, without reading host or other-bot credentials. Device login/refresh SHALL be owned by the pinned CLI inside the bot home. Vault tokens SHALL reach only the execution environment, never arguments, config files or storage; tool shells SHALL exclude their variables. Exact injected values SHALL be redacted across chunks before storage/delivery. Same-user bot processes SHALL NOT be described as isolated from these credentials.

#### Scenario: Two bots use the same provider

- **WHEN** one bot signs in and another bot using that provider starts without a configured sign-in
- **THEN** the second bot remains not signed in and receives none of the first bot's credentials

#### Scenario: Token mode with a saved login

- **WHEN** a bot with an existing device login selects an API key and starts work
- **THEN** the execution uses the selected API key, no key is saved to its home, and tool-shell output contains no injected credential variable

### Requirement: Approvals are enforced by the selected runtime

Claude Code SHALL support Autonomous and Ask me. Ask me requests SHALL become server-owned pending permission records; the first authorized device answer SHALL decide a request, later answers SHALL be refused, and expiry SHALL reject. Codex SHALL be Autonomous only with an explanation. An unsupported permission/control capability SHALL make the affected runtime unavailable with a reason; it SHALL NOT cause an Ask me execution to run with permissions bypassed.

#### Scenario: Claude asks permission

- **WHEN** an Ask me Claude execution requests a restricted tool action
- **THEN** the action waits for the server's permission decision and the bot shows needs you

#### Scenario: Control channel unavailable

- **WHEN** the pinned CLI cannot enforce Ask me
- **THEN** the execution is refused with a compatibility reason instead of launching autonomously

### Requirement: Native execution termination confirms process cleanup

Every terminal path SHALL revoke tools and confirm supervised process cleanup before releasing credential/work leases. Stop SHALL allow ten seconds for cancellation, then terminate and kill remaining group processes after five seconds. PID/start-time/nonce checks SHALL protect unrelated reused groups. Restart SHALL interrupt unfinished work without replay. Success SHALL require a valid terminal protocol outcome and successful exit; failures SHALL retain bounded redacted diagnostics.

#### Scenario: CLI exits but a tool remains

- **WHEN** a CLI exits while a command in its supervised process group still runs
- **THEN** the group is cleaned up before the execution's lease is released

#### Scenario: Server restarts

- **WHEN** the server restarts during a native execution
- **THEN** its group is cleaned up, pending permissions are cancelled, and the record becomes interrupted without resuming the CLI
