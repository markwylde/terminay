# mcp-server Specification

## Purpose

Terminay provides a local Model Context Protocol server that lets agent processes launched inside a Terminay terminal inspect and control terminal tabs in their own project, without learning about or controlling other projects, servers, workspace views, or clients.

## Requirements

### Requirement: Project-scoped MCP terminal control

Terminay SHALL provide a local Model Context Protocol server for Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode processes running inside Terminay terminals. An installed agent SHALL be able to inspect and control terminal tabs in its own project and SHALL NOT be able to learn about or control other projects, servers, workspace views, or clients.

#### Scenario: Agent lists terminals

- **WHEN** an agent launched inside a Terminay terminal lists terminals
- **THEN** it sees only terminal panels belonging to the calling terminal's canonical project

#### Scenario: Agent attempts cross-project control

- **WHEN** an agent attempts to address a terminal in another project or on another server
- **THEN** the request is refused

### Requirement: MCP is independent of agent status observation

MCP terminal control and agent-status observation SHALL be independent product capabilities. MCP SHALL register a Terminay stdio server with supported agent clients and give processes launched inside a Terminay terminal a project-scoped control capability. The Agents sidebar and terminal agent status SHALL continue to come from process-bound provider journals, including omp and Grok, and observing omp SHALL NOT register an MCP client. Installing, enabling, disabling, or removing Terminay MCP SHALL never install, edit, trust, invoke, or remove Codex, Claude Code, or omp hooks.

#### Scenario: omp observed

- **WHEN** Terminay observes an omp session for agent status
- **THEN** no MCP client is registered

#### Scenario: MCP installed

- **WHEN** Terminay MCP is installed, enabled, disabled, or removed
- **THEN** no provider hook configuration is installed, edited, trusted, invoked, or removed

#### Scenario: MCP does not affect agent discovery

- **WHEN** MCP registration state changes
- **THEN** how Terminay discovers or displays agents is unchanged

### Requirement: MCP product outcomes

A user SHALL be able to install or remove the Terminay MCP registration for Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode independently. Once installed, an agent launched normally inside a Terminay terminal SHALL be able to use Terminay tools without copying a socket path or token. MCP SHALL remain usable when no renderer is attached and across renderer reloads.

#### Scenario: Agent uses tools without manual configuration

- **WHEN** an agent is launched normally inside a Terminay terminal with MCP installed
- **THEN** it can call Terminay tools without the user copying a socket path or token

#### Scenario: No renderer attached

- **WHEN** no renderer is attached or a renderer reloads
- **THEN** MCP operations remain usable

### Requirement: Server ownership of the MCP surface

Terminay Server SHALL own the MCP stdio entry point, local control endpoint, capability issuance and revocation, scope resolution, terminal operations, subscriptions, and workspace mutations. It SHALL resolve operations directly against canonical server-owned project and terminal state. A renderer SHALL never be an authority or a routing hop.

#### Scenario: Operation resolution

- **WHEN** an MCP operation is executed
- **THEN** it resolves directly against canonical server-owned project and terminal state without passing through a renderer

### Requirement: Local-only control endpoint

The control endpoint SHALL be local to the server machine. It SHALL NOT use WebRTC, remote-device credentials, browser storage, or the hosted signalling service. It SHALL use a user-only Unix domain socket or the platform-equivalent local IPC transport and SHALL never listen on a TCP interface.

#### Scenario: Endpoint transport

- **WHEN** the MCP control endpoint is created
- **THEN** it uses a user-only Unix domain socket or platform-equivalent local IPC and listens on no TCP interface

#### Scenario: Remote credential presented

- **WHEN** a request attempts to reach the control endpoint using remote-device credentials or the hosted signalling service
- **THEN** it is not served

### Requirement: Environment eligibility for MCP

The initial capability SHALL be available only to project environments that can provide a proven server-local control transport. An environment that cannot provide that transport SHALL report MCP unavailable and SHALL NOT fall back to the local machine or a similarly named project or terminal. A remote environment MAY support MCP only through an authenticated environment bridge that preserves the same project and session scope.

#### Scenario: Environment without a local control transport

- **WHEN** a project environment cannot provide a proven server-local control transport
- **THEN** MCP is reported unavailable for it and no fallback to the local machine or a similarly named project or terminal occurs

#### Scenario: Remote environment bridge

- **WHEN** a remote environment supports MCP
- **THEN** it does so through an authenticated environment bridge preserving the same project and session scope

### Requirement: Registration management surface

Terminay SHALL expose an **Install Terminay MCP** action whose management surface detects the registration state for each supported agent, distinguishes not installed, installed, changed, unavailable, and error states, installs and removes Claude Code, Codex, Cursor CLI, Gemini CLI, and OpenCode independently, and identifies the provider-owned configuration scope being changed.

#### Scenario: Registration state shown

- **WHEN** a user opens the MCP management surface
- **THEN** each supported agent shows one of not installed, installed, changed, unavailable, or error, together with the provider-owned configuration scope being changed

#### Scenario: Independent install

- **WHEN** a user installs the registration for one provider
- **THEN** the other providers' registrations are unchanged

### Requirement: Terminay-owned registration entry

Registration SHALL use the provider's supported MCP configuration contract or CLI. Terminay SHALL create only its own named `terminay` stdio-server entry containing the stable command and arguments needed to start the packaged Terminay MCP adapter. The entry SHALL contain no terminal capability token, socket path, provider secret, project path, or hook configuration.

#### Scenario: Entry written

- **WHEN** Terminay writes its registration entry
- **THEN** the entry is named `terminay`, carries the stable command and arguments for the packaged adapter, and contains no token, socket path, provider secret, project path, or hook configuration

### Requirement: Installation safety

Unrelated provider configuration SHALL be preserved and removal SHALL delete only the Terminay-owned MCP entry. A matching entry SHALL be treated as already installed. An existing but changed `terminay` entry SHALL be shown for review and SHALL NOT be overwritten silently. Writes SHALL be atomic when Terminay writes configuration directly. Provider configuration parse or validation failures SHALL never cause a destructive rewrite. Diagnostics SHALL redact secrets and SHALL NOT include unrelated provider configuration. Registration SHALL NOT grant blanket tool approval or alter the provider's normal MCP trust and approval policy. No install, uninstall, detection, or repair path SHALL read or write provider hook configuration.

#### Scenario: Existing changed entry

- **WHEN** a `terminay` entry exists but differs from what Terminay would write
- **THEN** it is shown for review and is not overwritten silently

#### Scenario: Matching entry

- **WHEN** the existing `terminay` entry matches
- **THEN** the registration is treated as already installed

#### Scenario: Unparsable provider configuration

- **WHEN** a provider configuration file fails to parse or validate
- **THEN** no destructive rewrite occurs

#### Scenario: Removal

- **WHEN** a user removes the Terminay registration
- **THEN** only the Terminay-owned MCP entry is deleted and unrelated provider configuration is preserved

#### Scenario: Trust policy

- **WHEN** the registration is installed
- **THEN** the provider's normal MCP trust and approval policy is unchanged and no blanket tool approval is granted

### Requirement: Versioned provider registration adapters

Provider configuration formats and commands can change independently of Terminay. Provider-specific registration adapters SHALL be versioned and tested against their current supported contracts rather than sharing parsing logic with agent-status journal drivers.

#### Scenario: Provider format changes

- **WHEN** a provider changes its MCP configuration contract
- **THEN** only that versioned registration adapter changes, and agent-status journal drivers are unaffected

### Requirement: Isolated provider compatibility coverage

CI SHALL run a Docker-isolated compatibility test with the supported agent CLIs installed. The test SHALL give Terminay a container-only home directory, register the packaged stdio command through the same privileged adapters used by the application, and require each real CLI to load and report the `terminay` registration. It SHALL need no provider credentials, SHALL never use the host home directory, and SHALL fail when a client stops accepting Terminay's configuration contract.

#### Scenario: Client stops accepting the contract

- **WHEN** a supported agent CLI stops accepting Terminay's configuration contract
- **THEN** the Docker-isolated compatibility test fails

#### Scenario: No credentials required

- **WHEN** the compatibility test runs
- **THEN** it uses a container-only home directory and requires no provider credentials or host configuration access

### Requirement: Per-client user-wide registration contracts

Terminay SHALL register each client in its supported user-wide scope so the adapter is available to agents launched from any Terminay project. Claude Code SHALL use the `terminay` entry in `mcpServers` in `~/.claude.json`. Codex SHALL use the `[mcp_servers.terminay]` table in `~/.codex/config.toml`, including an `env_vars` whitelist for the inherited `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN` capability variables. Cursor CLI SHALL use the `terminay` entry in `mcpServers` in `~/.cursor/mcp.json`, shared with Cursor's user-level MCP configuration. Gemini CLI SHALL use the `terminay` entry in `mcpServers` in the user settings file `~/.gemini/settings.json`, retaining Gemini's normal per-tool confirmation policy. Grok SHALL use the `[mcp_servers.terminay]` table in `~/.grok/config.toml`, or `$GROK_HOME/config.toml` when that environment variable is set, without a Codex-style `env_vars` whitelist because Grok stdio MCP children inherit the terminal environment. OpenCode SHALL use the `terminay` local server in `mcp` in the active stable user configuration under `~/.config/opencode/`, using a command array and no trust or permission override.

#### Scenario: Codex registration

- **WHEN** Terminay registers with Codex
- **THEN** it writes the `[mcp_servers.terminay]` table in `~/.codex/config.toml` with an `env_vars` whitelist for `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN`

#### Scenario: Grok registration with GROK_HOME

- **WHEN** `$GROK_HOME` is set
- **THEN** Terminay writes the `[mcp_servers.terminay]` table in `$GROK_HOME/config.toml`

#### Scenario: OpenCode registration

- **WHEN** Terminay registers with OpenCode
- **THEN** it writes the `terminay` local server in `mcp` under `~/.config/opencode/` using a command array and no trust or permission override

#### Scenario: Gemini confirmation policy

- **WHEN** Terminay registers with Gemini CLI
- **THEN** the entry retains Gemini's normal per-tool confirmation policy

### Requirement: Ambiguous or unsupported provider configuration

When a provider supports multiple user configuration filenames, Terminay SHALL use the existing supported file without creating a competing file. If more than one candidate exists and there is no unambiguous provider precedence contract, Terminay SHALL report the registration unavailable for review. Unsupported syntax, including a configuration dialect Terminay cannot safely round-trip, SHALL also be reported as unavailable without rewriting the file.

#### Scenario: Multiple candidate files

- **WHEN** more than one candidate user configuration file exists with no unambiguous provider precedence contract
- **THEN** the registration is reported unavailable for review and no competing file is created

#### Scenario: Unsupported dialect

- **WHEN** the configuration uses a dialect Terminay cannot safely round-trip
- **THEN** the registration is reported unavailable and the file is not rewritten

### Requirement: MCP enablement switch

Settings SHALL contain an **Enable Terminay MCP server** switch. Disabling MCP SHALL stop accepting new requests, cancel or reject active requests, revoke live capabilities, and prevent new terminals from receiving one, and SHALL NOT remove provider registration. Re-enabling SHALL affect subsequently launched terminals and MAY issue fresh capabilities to eligible live terminals only when their exact canonical identity can be retained safely.

#### Scenario: Disabling MCP

- **WHEN** a user disables the MCP server
- **THEN** new requests are refused, active requests are cancelled or rejected, live capabilities are revoked, new terminals receive none, and provider registration remains installed

#### Scenario: Re-enabling MCP

- **WHEN** a user re-enables the MCP server
- **THEN** subsequently launched terminals receive capabilities, and live terminals receive fresh capabilities only where their exact canonical identity can be retained safely

### Requirement: MCP and agent status settings independence

MCP enablement SHALL be independent from **Agent status and sidebar**. Either feature SHALL be able to be enabled while the other is disabled, and changing one setting SHALL NOT mutate the other setting or its provider configuration.

#### Scenario: Independent settings combinations

- **WHEN** MCP and agent status are set to any of the four enabled and disabled combinations
- **THEN** each feature operates according to its own setting and neither mutates the other's setting or provider configuration

### Requirement: Terminal capability issuance

Each eligible terminal SHALL receive protected launch-environment values identifying the local control endpoint and a random per-terminal capability token. Child processes MAY inherit those values because they already execute with the calling terminal's shell authority, and Terminay SHALL explain this implication where MCP is enabled.

#### Scenario: Terminal launched with MCP enabled

- **WHEN** an eligible terminal is launched
- **THEN** it receives protected launch-environment values for the local control endpoint and a random per-terminal capability token

#### Scenario: Inheritance disclosure

- **WHEN** a user views the MCP enablement surface
- **THEN** Terminay explains that child processes inherit the terminal's capability values under the calling terminal's shell authority

### Requirement: Capability token scope and lifecycle

Presenting a token SHALL resolve to the immutable calling terminal and its canonical project. A token SHALL grant access only to terminal panels in that project, SHALL never enumerate project identity as an MCP tool concept, SHALL NOT address another project or server, SHALL be replaced or revoked atomically when its terminal changes project, SHALL be revoked on terminal exit, explicit revocation, server shutdown, or MCP disablement, and SHALL NOT be widened using a title, panel id, cwd, active tab, renderer state, process name, or copied metadata.

#### Scenario: Terminal changes project

- **WHEN** a terminal holding a capability changes project
- **THEN** its token is replaced or revoked atomically

#### Scenario: Terminal exits

- **WHEN** a terminal exits, its capability is explicitly revoked, the server shuts down, or MCP is disabled
- **THEN** the token is revoked

#### Scenario: Widening attempt

- **WHEN** a caller supplies a title, panel id, cwd, active tab, renderer state, process name, or copied metadata to reach another scope
- **THEN** the token's scope is not widened

### Requirement: Token secrecy

Raw tokens SHALL be protected at rest and excluded from logs, snapshots, settings, client messages, diagnostics, and MCP results.

#### Scenario: Diagnostics captured

- **WHEN** logs, snapshots, settings, client messages, diagnostics, or MCP results are produced
- **THEN** they contain no raw capability token

### Requirement: Stdio adapter lifecycle

The stdio adapter SHALL start with the agent client and read its connection details from the inherited terminal environment. It SHALL validate the endpoint and token before advertising tools and SHALL exit cleanly when stdin closes or authority is revoked.

#### Scenario: Adapter start

- **WHEN** the stdio adapter starts
- **THEN** it reads connection details from the inherited terminal environment and validates the endpoint and token before advertising tools

#### Scenario: Authority revoked

- **WHEN** stdin closes or the adapter's authority is revoked
- **THEN** the adapter exits cleanly

### Requirement: Bounded local control protocol

Control requests and responses SHALL be correlated, framed, size-bounded, and runtime-validated. Concurrency, request lifetime, output size, and pending waits SHALL be bounded. Invalid tokens and malformed requests SHALL return bounded failures that do not reveal valid scopes. Cancellation SHALL reach the terminal operation, and an aborted request SHALL NOT start a later backend mutation or publish a stale result.

#### Scenario: Malformed request

- **WHEN** a malformed or unauthenticated control request arrives
- **THEN** it returns a bounded failure that reveals no valid scopes

#### Scenario: Cancelled request

- **WHEN** a control request is cancelled
- **THEN** cancellation reaches the terminal operation and no later backend mutation starts and no stale result is published

### Requirement: Explicit operation dispatch

The server SHALL dispatch validated operations through an explicit operation-to-handler table. Handlers SHALL receive immutable resolved scope and a cancellation signal and SHALL never receive the raw token. Unsupported operations SHALL return a stable unsupported error rather than falling through to a renderer or local fallback. Unexpected failures SHALL become bounded generic errors.

#### Scenario: Unsupported operation

- **WHEN** a request names an operation the server does not support
- **THEN** it returns a stable unsupported error with no renderer or local fallback

#### Scenario: Handler input

- **WHEN** a handler executes
- **THEN** it receives immutable resolved scope and a cancellation signal and not the raw token

### Requirement: Project-implicit tool surface

Terminay SHALL expose the following project-implicit tools: `get_mcp_capabilities` reporting the globally available MCP operations for the bound host; `list_terminals` listing terminal panels in scope with opaque handles, display names, state, and active status; `read_terminal` reading either a bounded lossless raw-output range or a bounded current terminal-presentation snapshot; `search_terminal` searching a bounded current text presentation snapshot and returning bounded matching visual-row context; `get_terminal_status` returning canonical activity, attention, cwd, and last-exit information; `write_terminal` writing exact validated text to one live terminal; `run_command` writing one command and submitting it once, using bracketed paste for multiline input; `open_terminal` creating a terminal in the same project with an optional display name and policy-valid cwd; `close_terminal` closing one terminal through normal terminal lifecycle rules; `focus_terminal` making one terminal active in the logical workspace view without stealing focus in an unrelated client; `rename_terminal` changing one terminal's display title; `split_terminal` creating a split relative to one terminal; `wait_for_idle` waiting for bounded canonical terminal inactivity; `wait_for_command` waiting for the next structured command completion and returning bounded exit information; and `wait_for_attention` waiting for the next canonical needs-attention signal.

#### Scenario: Listing terminals

- **WHEN** an agent calls `list_terminals`
- **THEN** it receives opaque handles, display names, state, and active status for terminal panels in scope

#### Scenario: Focusing a terminal

- **WHEN** an agent calls `focus_terminal`
- **THEN** the terminal becomes active in the logical workspace view without stealing focus in an unrelated client

#### Scenario: Running a multiline command

- **WHEN** an agent calls `run_command` with multiline input
- **THEN** the command is written once using bracketed paste and submitted once

### Requirement: Names are not identities

Tool names for terminals SHALL be conveniences and not identities. An ambiguous name SHALL return bounded candidates instead of choosing one. Tool results SHALL never expose capability tokens, filesystem secrets, other projects, or other server connections.

#### Scenario: Ambiguous terminal name

- **WHEN** a supplied terminal name matches more than one terminal
- **THEN** bounded candidates are returned and no terminal is chosen

### Requirement: Restored terminals in listings

`list_terminals` SHALL include in-scope restored terminal records even when no live activity record exists for them, and those records SHALL use the bounded idle and no-attention fallback rather than failing the complete listing.

#### Scenario: Restored terminal without activity state

- **WHEN** an in-scope restored terminal has no live activity record
- **THEN** it appears in the listing with the bounded idle and no-attention fallback and the listing succeeds

### Requirement: Two distinct output representations

Terminal output SHALL have two deliberately different MCP representations. A raw stream position SHALL be a non-negative byte position in the PTY-output stream and SHALL NOT be a screen-row, command, or presentation cursor. Presentation rows are stateful because cursor movement, erasure, wrapping, and resize can change an earlier row, so Terminay SHALL never represent a raw-stream range as an exact range of rendered rows.

#### Scenario: Raw range interpreted as rows

- **WHEN** a caller reads a raw-stream range
- **THEN** the response does not describe it as an exact range of rendered rows

### Requirement: Canonical stream positions

Every terminal SHALL expose `replay_from`, the first retained raw byte position, and `output_position`, the exclusive position after the most recently accepted output byte. They SHALL be canonical server-owned positions, scoped to one terminal session, and invalid after that session is gone.

#### Scenario: Session ends

- **WHEN** a terminal session is gone
- **THEN** its previously issued `replay_from` and `output_position` values are invalid

### Requirement: Raw output range reads

`read_terminal` with `format: "raw"` SHALL be the lossless cursor and pagination operation taking `{ terminal, format: "raw", after?: position, max_bytes?: integer }`. `after` SHALL mean the raw-stream position immediately after bytes the caller has already consumed and the returned range SHALL be `[from, next)`. Omitting `after` SHALL start at `replay_from`; supplying the preceding response's `next` SHALL continue without resending retained bytes. `after` greater than `output_position` SHALL be an invalid request. If `after` precedes `replay_from`, the response SHALL begin at `replay_from` and set `history_lost: true` and SHALL NOT silently substitute a tail while claiming the requested history was available.

#### Scenario: Continuing pagination

- **WHEN** a caller supplies the preceding response's `next` as `after`
- **THEN** the response continues from that position without resending retained bytes

#### Scenario: after beyond output_position

- **WHEN** `after` is greater than `output_position`
- **THEN** the request is invalid

#### Scenario: after precedes retained history

- **WHEN** `after` precedes `replay_from`
- **THEN** the response begins at `replay_from` and sets `history_lost: true`

#### Scenario: after omitted

- **WHEN** `after` is omitted
- **THEN** the response begins at `replay_from`

### Requirement: Raw response payload and fields

The raw payload SHALL be exact PTY bytes encoded as Base64 and SHALL NOT be a lossy decoded string. The response SHALL contain `terminal`, `format: "raw"`, `encoding: "base64"`, `output`, `from`, `next`, `replay_from`, `output_position`, `history_lost`, and `truncated_tail`. `truncated_tail` SHALL mean more retained raw output existed at the captured `output_position` than fits the requested response budget, with `next` remaining the exclusive position of the emitted bytes so the caller can page forward. A response with no available bytes SHALL have `from` equal to `next`. `history_lost` SHALL be distinct from pagination and from a presentation that was shortened to fit.

#### Scenario: Budget exceeded by retained output

- **WHEN** more retained raw output exists than fits the requested budget
- **THEN** `truncated_tail` is true and `next` is the exclusive position of the emitted bytes

#### Scenario: No bytes available

- **WHEN** no bytes are available to return
- **THEN** `from` equals `next`

### Requirement: Current presentation snapshot reads

`read_terminal` with `format: "text"` or `format: "ansi"` SHALL read the current canonical emulated terminal presentation including its bounded retained scrollback, not a raw-output delta, and SHALL reject `after`. `text` SHALL return plain visual rows from the current emulator, where a visual row is a single xterm buffer row at the snapshot geometry including a wrapped portion of a logical line, and row strings SHALL contain no terminal control sequences. `lines`, when present, SHALL select the most recent visual rows. `ansi` SHALL return an ANSI serialization of the same emulated presentation suitable for recreating that presentation and SHALL NOT be a decoding of raw PTY bytes. Both responses SHALL report the captured `output_position` and `dimensions` and SHALL state whether older presentation content was omitted to meet a row or payload budget.

#### Scenario: after supplied to a presentation read

- **WHEN** `after` is supplied with `format: "text"` or `format: "ansi"`
- **THEN** the request is rejected

#### Scenario: lines requested

- **WHEN** `lines` is supplied
- **THEN** the most recent visual rows are selected

#### Scenario: Presentation response fields

- **WHEN** a presentation snapshot is returned
- **THEN** it reports the captured `output_position`, `dimensions`, and whether older presentation content was omitted

### Requirement: Presentation snapshots are not transcripts

Presentation snapshots MAY contain rows already returned by an earlier snapshot because they describe a current screen state rather than an append-only transcript. Agents SHALL use raw ranges when they require cursor-based, non-repeating delivery.

#### Scenario: Repeated rows across snapshots

- **WHEN** two presentation snapshots are taken in sequence
- **THEN** rows may repeat between them without indicating an error

### Requirement: Output response budgets

All output operations SHALL take `max_bytes`, defaulting to 16 KiB, bounding the UTF-8 byte length of the returned representation — Base64 characters for `raw`, text rows for `text`, and serialized ANSI text for `ansi`. The public maximum SHALL be 64 KiB, reserving space below the control endpoint's 256 KiB response limit for JSON, result fields, and MCP framing. The implementation SHALL also measure the complete serialized control and MCP result and reduce the payload if necessary, so a valid output read never fails only because output is large.

#### Scenario: max_bytes omitted

- **WHEN** an output operation omits `max_bytes`
- **THEN** the 16 KiB default bounds the returned representation

#### Scenario: Large output requested

- **WHEN** a valid output read would exceed the serialized result limit
- **THEN** the payload is reduced and the read succeeds rather than failing because output is large

### Requirement: Truncation boundaries

Raw pagination SHALL select only complete emitted Base64 quanta and SHALL advance `next` by exactly the decoded raw bytes. Text and ANSI presentation reads SHALL omit whole oldest rows or a complete valid presentation fragment rather than splitting a UTF-8 character or terminal control sequence, and SHALL report `presentation_truncated: true`. Validation, authority, cancellation, and terminal-lifecycle failures SHALL remain errors; the no-size-failure rule SHALL apply only to a valid output payload.

#### Scenario: Presentation shortened to fit

- **WHEN** a text or ANSI read must shorten its result
- **THEN** it omits whole oldest rows or a complete valid fragment, never splits a UTF-8 character or control sequence, and reports `presentation_truncated: true`

#### Scenario: Authority failure on a read

- **WHEN** a read fails validation, authority, cancellation, or terminal lifecycle
- **THEN** it returns an error

### Requirement: Presentation search input

`search_terminal` SHALL be separate from `read_terminal` and SHALL search the current emulated text presentation, never raw bytes or ANSI source. Its input SHALL be `{ terminal, query, case_sensitive?, context_lines?, max_matches?, max_bytes? }`. `query` SHALL be a non-empty literal Unicode string and not a regular expression. Matching SHALL default to case-sensitive; when `case_sensitive: false`, matching SHALL use Unicode simple case folding. `context_lines` SHALL default to 2 and be capped at 20. `max_matches` SHALL default to 20 and be capped at 100.

#### Scenario: Regular expression supplied

- **WHEN** a caller supplies a query
- **THEN** it is matched as a literal Unicode string and not as a regular expression

#### Scenario: Case-insensitive search

- **WHEN** `case_sensitive: false` is supplied
- **THEN** matching uses Unicode simple case folding

#### Scenario: Caps exceeded

- **WHEN** `context_lines` above 20 or `max_matches` above 100 is requested
- **THEN** the values are capped at 20 and 100

### Requirement: Presentation search results

Matches SHALL be ordered from the oldest retained visual row to the newest and each SHALL include its row text and up to the requested preceding and following visual rows. Row indexes, when returned, SHALL identify one snapshot only and SHALL NOT be cursors. Search SHALL use the same 16 KiB default and 64 KiB maximum result budget as a read, SHALL scan only the terminal's bounded retained presentation, and SHALL report the captured `output_position`, `dimensions`, `matches_truncated`, and `presentation_truncated`. It SHALL shorten context before omitting later matches and SHALL never let a large match set exceed the response budget.

#### Scenario: Large match set

- **WHEN** the match set would exceed the response budget
- **THEN** context is shortened before later matches are omitted and the budget is not exceeded

#### Scenario: Match ordering

- **WHEN** several rows match
- **THEN** matches are ordered from the oldest retained visual row to the newest with their requested context rows

### Requirement: Terminal write boundary

Writes SHALL target an exact immutable terminal session, SHALL fail after exit or revocation, and SHALL pass through the same authorization, recording, activity, input-ordering, and backpressure boundaries as other non-interactive terminal input. Multiline commands SHALL use the terminal's established paste and submission semantics.

#### Scenario: Write after terminal exit

- **WHEN** a write targets a terminal that has exited or whose capability was revoked
- **THEN** the write fails

#### Scenario: Write passes canonical boundaries

- **WHEN** an MCP write is accepted
- **THEN** it traverses the same authorization, recording, activity, input-ordering, and backpressure boundaries as other non-interactive terminal input

### Requirement: run_command response contract

`run_command` SHALL return `{ terminal, command_id, from, submitted_bytes, submitted: true }`. `command_id` SHALL uniquely identify the accepted MCP submission and SHALL NOT be a shell command identity, an activity event, or an exit status. `from` SHALL be the terminal's raw `output_position` captured immediately before the write is accepted and SHALL be a lower bound for observing output after submission rather than proof that bytes in a later raw range were produced by that command, because prompts, background jobs, and other writers can interleave. `submitted_bytes` SHALL be the exact number of PTY input bytes written, including the bracketed-paste wrapper and submission carriage return when used.

#### Scenario: Command submitted

- **WHEN** `run_command` accepts a submission
- **THEN** it returns `command_id`, the pre-write `output_position` as `from`, the exact `submitted_bytes` including wrapper and carriage return, and `submitted: true`

#### Scenario: Interleaved output after submission

- **WHEN** a caller reads raw output from `from`
- **THEN** `from` is only a lower bound and the range may include prompts, background jobs, and other writers' output

### Requirement: Wait tool semantics

Wait tools SHALL observe canonical server-owned terminal activity and SHALL return on their matching condition, terminal exit, timeout, cancellation, capability revocation, or server shutdown. A renderer reload or disconnected client SHALL NOT interrupt a wait. `wait_for_command` SHALL observe the next host-supported structured command completion and SHALL NOT be correlated to `run_command.command_id`. Hosts lacking structured command-completion or attention observation SHALL report that fact before the operation is called rather than implying an exit status is available.

#### Scenario: Renderer reloads during a wait

- **WHEN** a renderer reloads or disconnects while a wait is pending
- **THEN** the wait is not interrupted

#### Scenario: Host without structured completion

- **WHEN** a host cannot observe structured command completion or attention
- **THEN** that fact is reported before the operation is called

#### Scenario: Wait terminated by revocation

- **WHEN** the capability is revoked or the server shuts down while a wait is pending
- **THEN** the wait returns

### Requirement: Capability reporting

`get_mcp_capabilities` SHALL always be available after capability validation and SHALL return an adapter-global list of tool names and `available` booleans for the bound host. Availability SHALL NOT be a property of an individual terminal row. An unavailable optional tool MAY remain in the MCP registration for a stable client surface, but a caller SHALL be able to discover it through this result, and calls to it SHALL return `unsupported_op` without side effects.

#### Scenario: Optional tool unavailable

- **WHEN** an optional tool is unavailable for the bound host
- **THEN** `get_mcp_capabilities` reports it unavailable and calling it returns `unsupported_op` with no side effects

### Requirement: Cross-host response conformance

Desktop and standalone-server adapters SHALL share required response fields and their meanings. For terminal listings and status the common contract SHALL include the opaque `terminal`, canonical `status`, `output_position`, and `replay_from`, and output and search responses SHALL additionally follow the format contracts. A host MAY add documented presentation metadata such as a display name, local launch cwd, activity, attention, active state, or host-specific status detail. Conformance SHALL assert the required common contract and prohibit conflicting meanings rather than requiring identical host-extension shapes.

#### Scenario: Desktop and standalone listings

- **WHEN** a Desktop adapter and a standalone-server adapter return terminal listings or status
- **THEN** both carry the opaque `terminal`, canonical `status`, `output_position`, and `replay_from` with the same meanings

#### Scenario: Host extension field

- **WHEN** a host adds documented presentation metadata
- **THEN** it is permitted provided it does not conflict with a required common field's meaning

### Requirement: MCP security and privacy boundaries

MCP SHALL expose terminal control only; filesystem, Git, settings, secrets, recordings, extension administration, remote administration, and arbitrary native-window management SHALL remain outside the tool surface. Every request SHALL revalidate its capability against canonical terminal and project state. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** an agent seeks filesystem, Git, settings, secret, recording, extension-management, or remote-administration access through MCP
- **THEN** no such tool exists in the surface

#### Scenario: Authority from UI focus

- **WHEN** a request would be satisfied only by current UI focus or renderer ownership
- **THEN** the server does not infer authority from it

#### Scenario: Agent status via MCP

- **WHEN** MCP calls execute
- **THEN** no journal record is routed through MCP and no agent-status lifecycle event is synthesized

### Requirement: MCP failure behaviour

Missing, changed, or invalid provider registration SHALL be reported without changing provider configuration. A missing local endpoint or inherited capability SHALL make the MCP adapter unavailable and SHALL NOT broaden scope or attempt network discovery. Closing or moving the calling terminal, disabling MCP, or restarting the server SHALL invalidate stale authority immediately. A renderer failure SHALL NOT redirect, authorize, or keep alive an MCP request. Provider registration MAY remain installed while the Terminay server is stopped or MCP is disabled, and the provider SHALL receive an ordinary bounded server startup or connection failure.

#### Scenario: Missing endpoint

- **WHEN** the local endpoint or inherited capability is missing
- **THEN** the MCP adapter reports unavailable without broadening scope or attempting network discovery

#### Scenario: Calling terminal moved

- **WHEN** the calling terminal is closed or moved, MCP is disabled, or the server restarts
- **THEN** stale authority is invalidated immediately

#### Scenario: Server stopped with registration installed

- **WHEN** an agent starts the Terminay MCP adapter while the server is stopped or MCP is disabled
- **THEN** the provider receives an ordinary bounded startup or connection failure

#### Scenario: Renderer failure during a request

- **WHEN** a renderer fails while an MCP request is in flight
- **THEN** the failure does not redirect, authorize, or keep alive the request

### Requirement: MCP verification coverage

Registrations SHALL install and uninstall independently while preserving unrelated provider configuration, and install, uninstall, enable, disable, and repair operations SHALL create no provider hooks and SHALL NOT mutate provider hook, trust, or agent-status configuration. An installed agent inside a Terminay terminal SHALL be able to list and control only sibling terminals in its exact canonical project, and a copied token, title, panel id, cwd, or terminal name SHALL NOT cross project, environment, or server boundaries. Reads SHALL work without an attached renderer and pending waits SHALL survive renderer reload. Writes SHALL use the canonical terminal input boundary including correct multiline command submission. Disablement, terminal exit, project transfer, and server shutdown SHALL revoke old capabilities and release pending waits. The local endpoint SHALL never listen on a network interface and SHALL reject malformed, oversized, unauthenticated, stale, and cross-scope requests. Packaged Desktop and standalone-server artifacts SHALL start the same bounded stdio MCP adapter using their supported runtime layout.

#### Scenario: Copied identifier

- **WHEN** a token, title, panel id, cwd, or terminal name is copied to another project, environment, or server
- **THEN** it does not grant access there

#### Scenario: Project transfer during a wait

- **WHEN** a terminal is transferred to another project while a wait is pending
- **THEN** the old capability is revoked and the pending wait is released

#### Scenario: Packaged artifacts

- **WHEN** the packaged Desktop or standalone-server artifact starts MCP
- **THEN** both start the same bounded stdio adapter using their supported runtime layout

#### Scenario: Hostile control request

- **WHEN** a malformed, oversized, unauthenticated, stale, or cross-scope control request arrives
- **THEN** it is rejected and the endpoint remains off any network interface

### Requirement: MCP non-goals

MCP SHALL NOT provide provider hooks of any kind, agent lifecycle detection, Agents sidebar population, or terminal agent-status inference. It SHALL NOT provide cross-project or cross-server terminal control, a public or remotely discoverable network MCP endpoint, or filesystem, Git, settings, recording, secret, extension-management, or remote-access tools. It SHALL NOT establish trust based on terminal title, process name, cwd, active UI focus, or renderer state.

#### Scenario: Remote discovery attempted

- **WHEN** a remote party attempts to discover or reach the MCP endpoint over a network
- **THEN** no publicly discoverable network MCP endpoint exists

#### Scenario: Trust from terminal title

- **WHEN** a request presents a matching terminal title, process name, or cwd instead of a valid capability
- **THEN** no trust is established
