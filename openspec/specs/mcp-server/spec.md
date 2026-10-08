# mcp-server Specification

## Purpose

Terminay provides a local Model Context Protocol server that lets agent processes launched inside a Terminay terminal inspect and control terminal tabs in their own project and manage the server's automations, within the user's MCP permission policy, without learning about or controlling other projects, servers, workspace views, or clients.

## Requirements

### Requirement: Project-scoped MCP terminal control

Terminay SHALL provide a local Model Context Protocol server for Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode processes running inside Terminay terminals. An installed agent in a project terminal SHALL be able to inspect and control terminal tabs in its own project and SHALL NOT be able to learn about or control other projects, servers, workspace views, or clients. A process in a terminal of the automation terminal space SHALL instead hold the workspace scope defined for automation terminals, and SHALL NOT be able to learn about or control other servers, workspace views, or clients.

#### Scenario: Agent lists terminals

- **WHEN** an agent launched inside a project terminal lists terminals
- **THEN** it sees only terminal panels belonging to the calling terminal's canonical project

#### Scenario: Agent attempts cross-project control

- **WHEN** an agent in a project terminal attempts to address a terminal in another project or on another server
- **THEN** the request is refused

#### Scenario: Automation terminal lists terminals

- **WHEN** a process in an automation terminal lists terminals
- **THEN** it sees the terminal panels of every project and of the automation terminal space on its own server, and nothing on another server

### Requirement: MCP is independent of agent status observation

MCP terminal control and agent status SHALL be independent product capabilities, even when one extension contributes both a session source and MCP install targets. MCP SHALL register a Terminay stdio server with supported agent clients and give processes launched inside a Terminay terminal a project-scoped control capability. The Agents sidebar and terminal agent status SHALL come only from session sources. Observing any harness SHALL NOT register an MCP client. Installing, enabling, disabling, or removing Terminay MCP SHALL never install, edit, trust, invoke, or remove provider hooks.

#### Scenario: omp observed

- **WHEN** Terminay reports an oh-my-pi session for agent status
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

The control endpoint SHALL be local to the server machine. It SHALL NOT use WebRTC, remote-device credentials, browser storage, or the hosted signalling service. It SHALL use a user-only Unix domain socket or the platform-equivalent local IPC transport and SHALL never listen on a TCP interface. A Unix domain socket SHALL be readable and writable by its owner only, and the directory that holds it SHALL be accessible to its owner only.

#### Scenario: Endpoint transport

- **WHEN** the MCP control endpoint is created
- **THEN** it uses a user-only Unix domain socket or platform-equivalent local IPC and listens on no TCP interface

#### Scenario: Remote credential presented

- **WHEN** a request attempts to reach the control endpoint using remote-device credentials or the hosted signalling service
- **THEN** it is not served

#### Scenario: Socket and directory permissions

- **WHEN** the control endpoint is listening on a Unix domain socket
- **THEN** the socket grants access to its owner only and so does the directory that holds it

### Requirement: Registration management surface

Terminay SHALL expose an **Install Terminay MCP** action on Desktop. Its management surface SHALL list every MCP install target contributed by an enabled extension. The built-in agents extension contributes Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode. For each target the surface SHALL:

- show one of not installed, installed, changed, unavailable, or error
- identify the provider-owned configuration scope being changed
- install and remove that target independently

Server Core SHALL route every detection, install, and removal to the contributing extension with the host-supplied MCP server command. When no enabled extension contributes a target, the surface SHALL say that MCP install targets come from the built-in agents extension and that it is disabled or missing, and SHALL offer no install action.

#### Scenario: Registration state shown

- **WHEN** a user opens the MCP management surface
- **THEN** each contributed target shows one of not installed, installed, changed, unavailable, or error, together with the provider-owned configuration scope being changed

#### Scenario: Independent install

- **WHEN** a user installs the registration for one target
- **THEN** the other targets' registrations are unchanged

#### Scenario: Agents extension disabled

- **WHEN** the built-in agents extension is disabled and the user opens the MCP management surface
- **THEN** it explains that install targets come from that extension and offers no install action

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

Provider configuration formats and commands can change independently of Terminay. Provider-specific registration adapters SHALL live in the extension that contributes the install target, SHALL be versioned, and SHALL be tested against their current supported contracts. They SHALL share no parsing logic with session detection.

#### Scenario: Provider format changes

- **WHEN** a provider changes its MCP configuration contract
- **THEN** only that install target's adapter in the contributing extension changes, and session detection is unaffected

### Requirement: Isolated provider compatibility coverage

CI SHALL run a Docker-isolated compatibility test with the supported agent CLIs installed. The test SHALL give Terminay a container-only home directory. It SHALL register the packaged stdio command through the same extension install targets used by the application, and SHALL require each real CLI to load and report the `terminay` registration. It SHALL need no provider credentials, SHALL never use the host home directory, and SHALL fail when a client stops accepting Terminay's configuration contract.

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

Presenting a token SHALL resolve to the immutable calling terminal and its canonical scope: its project for a project terminal, or the workspace scope for a terminal in the automation terminal space. A project-scope token SHALL grant access only to terminal panels in that project and SHALL never enumerate project identity as an MCP tool concept. No token SHALL address another server. A token SHALL be replaced or revoked atomically when its terminal changes project or leaves or enters the automation terminal space, SHALL be revoked on terminal exit, explicit revocation, server shutdown, or MCP disablement, and SHALL NOT be widened using a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata.

#### Scenario: Terminal changes project

- **WHEN** a terminal holding a capability changes project
- **THEN** its token is replaced or revoked atomically

#### Scenario: Terminal exits

- **WHEN** a terminal exits, its capability is explicitly revoked, the server shuts down, or MCP is disabled
- **THEN** the token is revoked

#### Scenario: Widening attempt

- **WHEN** a caller supplies a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata to reach another scope
- **THEN** the token's scope is not widened

#### Scenario: Automation terminal moved into a project

- **WHEN** a terminal is moved from the automation terminal space into a project
- **THEN** its workspace-scope token is replaced with a project-scope token or revoked atomically

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

Control requests and responses SHALL be correlated, framed, size-bounded, and runtime-validated. Concurrency, output size, and pending waits SHALL be bounded. Request lifetime SHALL be bounded, except that while a request waits on a pending MCP approval its lifetime SHALL be bounded by that approval's lifecycle instead of a timer. Invalid tokens and malformed requests SHALL return bounded failures that do not reveal valid scopes. Cancellation SHALL reach the terminal operation or pending approval, and an aborted request SHALL NOT start a later backend mutation or publish a stale result.

#### Scenario: Malformed request

- **WHEN** a malformed or unauthenticated control request arrives
- **THEN** it returns a bounded failure that reveals no valid scopes

#### Scenario: Cancelled request

- **WHEN** a control request is cancelled
- **THEN** cancellation reaches the terminal operation and no later backend mutation starts and no stale result is published

#### Scenario: Request waiting on approval

- **WHEN** a request has waited on a pending approval longer than the ordinary request lifetime
- **THEN** it keeps waiting, and it ends only as the approval lifecycle defines

#### Scenario: Cancelled while awaiting approval

- **WHEN** a request waiting on a pending approval is cancelled
- **THEN** the approval is withdrawn from every client and the operation never runs, even if a user approves at the same moment

### Requirement: Explicit operation dispatch

The server SHALL dispatch validated operations through an explicit operation-to-handler table. Handlers SHALL receive immutable resolved scope and a cancellation signal and SHALL never receive the raw token. Unsupported operations SHALL return a stable unsupported error rather than falling through to a renderer or local fallback. Unexpected failures SHALL become bounded generic errors.

#### Scenario: Unsupported operation

- **WHEN** a request names an operation the server does not support
- **THEN** it returns a stable unsupported error with no renderer or local fallback

#### Scenario: Handler input

- **WHEN** a handler executes
- **THEN** it receives immutable resolved scope and a cancellation signal and not the raw token

### Requirement: Project-implicit tool surface

Terminay SHALL expose the following project-implicit tools: `get_mcp_capabilities` reporting the globally available MCP operations for the bound host; `list_terminals` listing terminal panels in scope with opaque handles, display names, state, and active status; `read_terminal` reading either a bounded lossless raw-output range or a bounded current terminal-presentation snapshot; `search_terminal` searching a bounded current text presentation snapshot and returning bounded matching visual-row context; `get_terminal_status` returning canonical activity, attention, cwd, and last-exit information; `write_terminal` writing exact validated text to one live terminal; `run_command` writing one command and submitting it once as a paste followed by Enter, framed with bracketed paste only when the foreground program has enabled it; `open_terminal` creating a terminal in the same project with an optional display name and policy-valid cwd; `close_terminal` closing one terminal through normal terminal lifecycle rules; `focus_terminal` making one terminal active in the logical workspace view without stealing focus in an unrelated client; `rename_terminal` changing one terminal's display title; `split_terminal` creating a split relative to one terminal; `wait_for_idle` waiting for bounded canonical terminal inactivity; `wait_for_command` waiting for the next structured command completion and returning bounded exit information; and `wait_for_attention` waiting for the next canonical needs-attention signal.

#### Scenario: Listing terminals

- **WHEN** an agent calls `list_terminals`
- **THEN** it receives opaque handles, display names, state, and active status for terminal panels in scope

#### Scenario: Focusing a terminal

- **WHEN** an agent calls `focus_terminal`
- **THEN** the terminal becomes active in the logical workspace view without stealing focus in an unrelated client

#### Scenario: Running a multiline command

- **WHEN** an agent calls `run_command` with multiline input and the foreground program has enabled bracketed paste
- **THEN** the command is written once using bracketed paste and submitted once

#### Scenario: Running a command where bracketed paste is off

- **WHEN** an agent calls `run_command` and the foreground program has not enabled bracketed paste
- **THEN** the command is written without bracketed-paste markers, each line break is sent as a carriage return, and the command is submitted with a final carriage return

#### Scenario: Leading assignment in a shell without bracketed paste

- **WHEN** an agent calls `run_command` with `X=1 sh -c 'echo $X'` in a shell that has not enabled bracketed paste
- **THEN** the shell reads the assignment as an assignment and prints `1`

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

`run_command` SHALL return `{ terminal, command_id, from, submitted_bytes, submitted: true, bracketed }`. `command_id` SHALL uniquely identify the accepted MCP submission and SHALL NOT be a shell command identity, an activity event, or an exit status. `from` SHALL be the terminal's raw `output_position` captured immediately before the write is accepted and SHALL be a lower bound for observing output after submission rather than proof that bytes in a later raw range were produced by that command, because prompts, background jobs, and other writers can interleave. `submitted_bytes` SHALL be the exact number of PTY input bytes written, including the bracketed-paste wrapper when used and the submission carriage return. `bracketed` SHALL be `true` exactly when the command was framed with bracketed-paste markers, which SHALL happen only when the terminal's canonical emulator reports that the foreground program has enabled bracketed paste; when that state is unknown the command SHALL be sent unframed.

#### Scenario: Command submitted

- **WHEN** `run_command` accepts a submission
- **THEN** it returns `command_id`, the pre-write `output_position` as `from`, the exact `submitted_bytes` including any wrapper and the carriage return, `submitted: true`, and `bracketed`

#### Scenario: Interleaved output after submission

- **WHEN** a caller reads raw output from `from`
- **THEN** `from` is only a lower bound and the range may include prompts, background jobs, and other writers' output

#### Scenario: Bracketed paste state unknown

- **WHEN** `run_command` targets a terminal whose canonical emulator is unavailable
- **THEN** the command is sent without bracketed-paste markers and `bracketed` is `false`

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

`get_mcp_capabilities` SHALL always be available after capability validation. It SHALL return an adapter-global list of tool names, each with an `available` boolean for the bound host and its effective permission as `allow`, `ask`, or `deny`. The effective permission SHALL reflect the tool's group policy and any session grant the calling terminal holds. Availability SHALL NOT be a property of an individual terminal row. An unavailable optional tool MAY remain in the MCP registration for a stable client surface, but a caller SHALL be able to discover it through this result, and calls to it SHALL return `unsupported_op` without side effects. A tool whose permission is `deny` SHALL remain in the registration and SHALL return `permission_denied` without side effects.

#### Scenario: Optional tool unavailable

- **WHEN** an optional tool is unavailable for the bound host
- **THEN** `get_mcp_capabilities` reports it unavailable and calling it returns `unsupported_op` with no side effects

#### Scenario: Permissions reported

- **WHEN** Full Automation Management is Ask Permission and the calling terminal holds no session grant
- **THEN** `get_mcp_capabilities` reports `create_automation` as available with permission `ask`

#### Scenario: Session grant reported

- **WHEN** the calling terminal holds a session grant for Full Automation Management
- **THEN** `get_mcp_capabilities` reports `create_automation` with permission `allow`

### Requirement: Cross-host response conformance

Desktop and standalone-server adapters SHALL share required response fields and their meanings. For terminal listings and status the common contract SHALL include the opaque `terminal`, canonical `status`, `output_position`, and `replay_from`, and output and search responses SHALL additionally follow the format contracts. A host MAY add documented presentation metadata such as a display name, local launch cwd, activity, attention, active state, or host-specific status detail. Conformance SHALL assert the required common contract and prohibit conflicting meanings rather than requiring identical host-extension shapes.

#### Scenario: Desktop and standalone listings

- **WHEN** a Desktop adapter and a standalone-server adapter return terminal listings or status
- **THEN** both carry the opaque `terminal`, canonical `status`, `output_position`, and `replay_from` with the same meanings

#### Scenario: Host extension field

- **WHEN** a host adds documented presentation metadata
- **THEN** it is permitted provided it does not conflict with a required common field's meaning

### Requirement: MCP security and privacy boundaries

Terminay's own MCP tools SHALL expose terminal control, automation management, and the calling terminal's app windows only; filesystem, Git, settings, secrets, recordings, extension administration, remote administration, and arbitrary native-window management SHALL remain outside Terminay's own tool surface. The single file read in that surface is the stdio adapter reading the document an agent names for `show_window`: it is performed by the adapter and never by the Terminay Server, its contents are shown to the user in a window, and they SHALL NEVER be returned to the agent. The surface MAY additionally carry the tools of MCP servers the user has connected in Settings; such a tool SHALL be named with its entry's prefix, SHALL be run by that server and never by Terminay, and SHALL NOT gain any Terminay authority. Every request SHALL revalidate its capability against canonical terminal and project state and SHALL be evaluated against the MCP permission policy before it is dispatched. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** an agent seeks filesystem, Git, settings, secret, recording, extension-management, or remote-administration access through Terminay's own tools
- **THEN** no such Terminay tool exists in the surface

#### Scenario: Agent names a file it wants to read

- **WHEN** an agent calls `show_window` with `html_file` naming a file that is not an HTML document, such as a private key
- **THEN** the file's text is shown to the user in a window, and neither the tool result nor any later tool result carries it to the agent

#### Scenario: Connected server offers a file tool

- **WHEN** a server the user connected offers a tool that reads files
- **THEN** it is listed under that entry's prefix, runs in that server, and holds no Terminay capability

#### Scenario: Authority from UI focus

- **WHEN** a request would be satisfied only by current UI focus or renderer ownership
- **THEN** the server does not infer authority from it

#### Scenario: Agent status via MCP

- **WHEN** MCP calls execute
- **THEN** no journal record is routed through MCP and no agent-status lifecycle event is synthesized

#### Scenario: Automation management requires permission

- **WHEN** an agent calls an automation-management tool
- **THEN** the server evaluates the MCP permission policy for it before any automation changes

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

Registrations SHALL install and uninstall independently while preserving unrelated provider configuration, and install, uninstall, enable, disable, and repair operations SHALL create no provider hooks and SHALL NOT mutate provider hook, trust, or agent-status configuration. An installed agent inside a Terminay terminal SHALL be able to list and control only sibling terminals in its exact canonical project, and a copied token, title, panel id, cwd, or terminal name SHALL NOT cross project or server boundaries. Reads SHALL work without an attached renderer and pending waits SHALL survive renderer reload. Writes SHALL use the canonical terminal input boundary including correct multiline command submission. Disablement, terminal exit, project transfer, and server shutdown SHALL revoke old capabilities and release pending waits. The local endpoint SHALL never listen on a network interface and SHALL reject malformed, oversized, unauthenticated, stale, and cross-scope requests. Packaged Desktop and standalone-server artifacts SHALL start the same bounded stdio MCP adapter using their supported runtime layout.

#### Scenario: Copied identifier

- **WHEN** a token, title, panel id, cwd, or terminal name is copied to another project or server
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

MCP SHALL NOT provide provider hooks of any kind, agent lifecycle detection, Agents sidebar population, or terminal agent-status inference. It SHALL NOT provide cross-project or cross-server terminal control, a public or remotely discoverable network MCP endpoint, or Terminay-implemented filesystem, Git, settings, recording, secret, extension-management, or remote-access tools. It SHALL NOT read or modify an agent CLI's own MCP server configuration beyond Terminay's own registration entry. It SHALL NOT establish trust based on terminal title, process name, cwd, active UI focus, or renderer state.

#### Scenario: Remote discovery attempted

- **WHEN** a remote party attempts to discover or reach the MCP endpoint over a network
- **THEN** no publicly discoverable network MCP endpoint exists

#### Scenario: Trust from terminal title

- **WHEN** a request presents a matching terminal title, process name, or cwd instead of a valid capability
- **THEN** no trust is established

#### Scenario: Agent's other MCP servers

- **WHEN** an agent CLI has other MCP servers configured
- **THEN** Terminay does not read, list, or change them

### Requirement: MCP eligibility on the server

MCP SHALL be available to every project on the server, because the server provides a proven server-local control transport for the sessions it owns. MCP SHALL NOT fall back to another machine or to a similarly named project or terminal.

#### Scenario: Project on the server

- **WHEN** a project on the server enables MCP
- **THEN** it is served through the proven server-local control transport

#### Scenario: Similarly named project or terminal

- **WHEN** a request names a project or terminal that merely resembles the scoped one
- **THEN** it is not served and no fallback to that project, terminal, or another machine occurs

### Requirement: One MCP socket per server and no cross-server addressing

Each Terminay Server SHALL expose its own MCP control socket and capability
tokens, and a client SHALL reach a server's MCP only over that server's own
connection. A server SHALL refuse a request naming a project, terminal, or
capability token issued by another server, and SHALL NEVER forward it. No socket,
token, or tool listing SHALL span attached servers.

#### Scenario: Two attached servers

- **WHEN** a window attaches two servers that both enable MCP
- **THEN** each server exposes its own socket and tokens, and neither lists the
  other's projects or terminals

#### Scenario: Token from another server

- **WHEN** a request presents a capability token issued by a different server
- **THEN** the request is refused and is not forwarded to the issuing server

#### Scenario: Colliding ids

- **WHEN** two attached servers hold a terminal with the same id and a request
  names that id
- **THEN** it resolves only on the server it was sent to

### Requirement: Workspace scope for automation terminals

Only a terminal in the automation terminal space SHALL receive a workspace-scope capability, and the server SHALL decide that from the terminal's canonical placement alone. A workspace-scope capability SHALL grant the same tools as a project scope, over the terminal panels of every project and of the automation terminal space on the owning server. With that scope, `list_terminals` SHALL identify each terminal's project by an opaque project handle and its display title, `open_terminal` SHALL create the terminal in the automation terminal space unless the caller names a project handle from a listing, and every other tool SHALL address terminals only by the opaque handles those listings return. A workspace scope SHALL NEVER grant anything the MCP security boundaries exclude, and its automation tools SHALL be governed by the MCP permission policy exactly as a project scope's are.

#### Scenario: Script opens an agent terminal

- **WHEN** a scheduled script with a workspace-scope capability calls `open_terminal` without a project handle
- **THEN** the terminal is created in the automation terminal space and receives its own workspace-scope capability

#### Scenario: Script opens a terminal in a project

- **WHEN** a workspace-scope caller calls `open_terminal` with a project handle it obtained from `list_terminals`
- **THEN** the terminal is created in that project and receives a project-scope capability

#### Scenario: Project terminal cannot obtain workspace scope

- **WHEN** a process in a project terminal presents its own token, or copies an automation terminal's environment variables into a new shell inside the project terminal
- **THEN** its own token resolves only to its project, and a copied token remains bound to the automation terminal it was minted for and is revoked when that terminal exits

#### Scenario: Automation run asks to manage automations

- **WHEN** a process in an automation run terminal calls `create_automation` while Full Automation Management is Ask Permission
- **THEN** the run terminal's pane shows the approval prompt and nothing is created until a user allows it

### Requirement: Automation management tools

Terminay SHALL expose these automation tools:

- `list_automations` lists the owning server's automations, each with its id, name, enabled state, trigger, action kind, next scheduled run where there is one, and last run outcome.
- `get_automation` returns one automation's full definition.
- `list_automation_runs` returns a bounded page of one automation's run log.
- `create_automation` creates an automation.
- `update_automation` replaces one automation's name, trigger, action, or settings, and requires the revision the caller last read.
- `delete_automation` deletes one automation without stopping runs already in progress.
- `set_automation_enabled` enables or disables one automation.
- `run_automation` starts one run now.
- `stop_automation_run` stops one run in progress.

Automations are server-wide, so these tools SHALL address every automation on the owning server from both project-scope and workspace-scope capabilities. They SHALL NEVER address another server's automations. Definitions SHALL be validated exactly as automations saved from the Automations section are. `run_automation` for a subject-terminal action SHALL require a subject terminal handle that the caller could address with its own scope. A project-scope caller SHALL NEVER see the subject terminal, subject project, or output tail of a run whose subject lies outside its project; those fields SHALL be withheld from its results. Every automation tool SHALL be governed by the MCP permission policy.

#### Scenario: Agent schedules a script

- **WHEN** an agent in a project terminal calls `create_automation` with a daily 09:00 schedule that runs `~/bin/report.sh`, and the request is permitted
- **THEN** the automation is created on the owning server, appears in every client's Automations section, and the tool returns its id

#### Scenario: Stale update

- **WHEN** an agent calls `update_automation` with a revision older than the automation's current one
- **THEN** the update fails with a conflict and the automation is unchanged

#### Scenario: Run log from another project

- **WHEN** a project-scope caller lists the runs of an automation triggered by an agent finishing in a different project
- **THEN** the run outcomes and times are returned without the subject terminal, subject project, or output tail

#### Scenario: Subject terminal outside scope

- **WHEN** a project-scope caller calls `run_automation` for a write-text automation naming a terminal handle outside its project
- **THEN** the request is refused and nothing runs

### Requirement: App window tools

Terminay SHALL expose three tools that act on the calling terminal's app windows. `show_window` SHALL take a title of at most 80 characters and an HTML document of at most 512 KiB, open an agent-authored window in the calling terminal, and return the new window's opaque handle; given the handle of an existing agent-authored window of the calling terminal, it SHALL replace that window's title and content in place and restore it. `close_window` SHALL close one window of the calling terminal by handle. `list_windows` SHALL return the calling terminal's windows with handle, title, source, and open or minimised state. A window handle SHALL be valid only for the terminal that owns the window. The tools' descriptions SHALL tell the agent that the HTML may use inline and `https` resources and may send a message back through the provided script interface.

#### Scenario: Hello world

- **WHEN** an agent calls `show_window` with the title "Hello" and an HTML document containing a heading
- **THEN** a window titled "Hello" opens in the calling terminal showing the heading, and the call returns its handle

#### Scenario: Updating a window

- **WHEN** an agent calls `show_window` with the handle of a window it opened and new HTML
- **THEN** the same window shows the new content and no second window is created

#### Scenario: Document too large

- **WHEN** an agent calls `show_window` with an HTML document over 512 KiB
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: Handle from another terminal

- **WHEN** an agent calls `close_window` with a handle that belongs to another terminal
- **THEN** the call fails as not found and no window closes

#### Scenario: Listing windows

- **WHEN** an agent calls `list_windows` in a terminal with one agent-authored window and one MCP App window
- **THEN** it receives both, each with its handle, title, source, and state

### Requirement: show_window loads a document from a file and carries data

`show_window` SHALL take its HTML document either inline as `html` or as `html_file`, the absolute path of a file, and SHALL refuse a call that gives both or neither. For `html_file` the stdio adapter SHALL read the file itself, in the agent's own process tree and with the agent's own filesystem authority, and SHALL send its contents as the document; the path SHALL NEVER be sent to, or opened by, the Terminay Server. The adapter SHALL read only a regular file of at most 512 KiB that is valid UTF-8, and SHALL otherwise fail the call with a bounded error that names the reason and not the file's contents. The contents of the file SHALL NEVER appear in the tool's result.

`show_window` SHALL also take an optional `data`, a JSON value of at most 64 KiB when serialised, stored on the window record for the view to read. Replacing a window's content SHALL replace its data. The tool's description SHALL tell the agent that a saved document with `data` avoids writing the document out again, and how the document reads the data.

#### Scenario: A saved questionnaire

- **WHEN** an agent calls `show_window` with a title, `html_file` naming a saved questionnaire document, and `data` holding three questions
- **THEN** a window opens showing that document with those three questions, and the call returns its handle without the document's contents

#### Scenario: Both html and html_file

- **WHEN** an agent calls `show_window` with both `html` and `html_file`
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: File missing

- **WHEN** an agent calls `show_window` with an `html_file` that does not exist
- **THEN** the call fails with a not-found error and no window is created

#### Scenario: Not a regular file

- **WHEN** an agent calls `show_window` with an `html_file` that names a directory, a device, or a named pipe
- **THEN** the call fails with a bounded error, nothing is read from it, and no window is created

#### Scenario: File too large

- **WHEN** an agent calls `show_window` with an `html_file` over 512 KiB
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: Data too large

- **WHEN** an agent calls `show_window` with `data` over 64 KiB
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: The server never sees the path

- **WHEN** an agent calls `show_window` with `html_file`
- **THEN** the request the adapter sends to the Terminay Server carries the document and no path

### Requirement: Control endpoint socket placement

The control endpoint's Unix domain socket SHALL be placed inside the server's data directory whenever the socket's path there is within the platform's limit for a Unix socket path. When it is not, the socket SHALL be placed in a runtime directory outside the data directory: a directory whose name is derived from the data directory's path, inside the user's runtime directory where the platform provides one and the system temporary directory otherwise. The same data directory SHALL always resolve to the same socket path, so that a terminal launched before a restart can still reach the endpoint after it.

A runtime directory SHALL be used only when it is a directory, is not a symbolic link, is owned by the user the server runs as, and grants no access to any other user. The server SHALL create it with those properties when it does not exist. The server SHALL NOT use, repair, or replace a path that exists and fails any of those conditions.

The platform limit SHALL be measured in bytes of the encoded path, not characters.

#### Scenario: Data directory at an ordinary path

- **WHEN** the socket's path inside the data directory is within the platform limit
- **THEN** the socket is created inside the data directory and no runtime directory is created

#### Scenario: Data directory at a long path

- **WHEN** the socket's path inside the data directory exceeds the platform limit
- **THEN** the server starts, the socket is created in an owner-only runtime directory outside the data directory, and a terminal launched by that server reaches the endpoint

#### Scenario: Same data directory, same address

- **WHEN** a server whose socket is in a runtime directory is stopped and started again with the same data directory
- **THEN** the socket is at the same path as before

#### Scenario: Two data directories

- **WHEN** two servers run with different data directories whose socket paths both exceed the limit
- **THEN** each uses its own runtime directory and neither listens on the other's socket

#### Scenario: Runtime directory prepared by someone else

- **WHEN** the runtime directory's path already exists and is a symbolic link, is not a directory, is owned by another user, or grants access to another user
- **THEN** the server does not listen there and does not change that path

#### Scenario: Non-ASCII data directory

- **WHEN** the data directory's path contains multi-byte characters and its socket path is within the limit in characters but over it in bytes
- **THEN** the socket is placed in a runtime directory

### Requirement: Reporting a control endpoint that cannot be placed

When the control endpoint's socket cannot be placed, because the data directory's path is too long and no runtime directory is usable, Desktop SHALL say so in its launch recovery state in place of the general failure message. The message SHALL state that the data directory's path is too long for a local socket, SHALL give the data directory's path, the length of the socket path, and the limit, and SHALL state that a shorter data directory resolves it. When a runtime directory was refused, the message SHALL name that directory and the reason. The failure SHALL also be recorded in Desktop diagnostics. The message SHALL NOT include a capability token.

#### Scenario: No usable placement

- **WHEN** Desktop starts with a data directory whose socket path is too long and the runtime directory's path is also over the limit
- **THEN** the launch recovery state says the data directory's path is too long for a local socket, gives the path and the limit, and says to use a shorter data directory

#### Scenario: Runtime directory refused

- **WHEN** Desktop starts with a data directory whose socket path is too long and the runtime directory exists but is owned by another user
- **THEN** the launch recovery state names that directory and says it is not owned by the current user, and Desktop does not listen there

#### Scenario: Recorded for support

- **WHEN** the control endpoint cannot be placed
- **THEN** Desktop diagnostics hold a record of the failure with the paths and lengths involved and no capability token
