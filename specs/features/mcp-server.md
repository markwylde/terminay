# Terminay MCP Server Specification

## Summary

Terminay provides a local Model Context Protocol server for Claude Code, Codex,
Cursor CLI, Gemini CLI, and OpenCode processes running inside Terminay
terminals. An installed agent can
inspect and control terminal tabs in its own project without learning about or
controlling other projects, servers, workspace views, or clients.

MCP terminal control and agent-status observation are independent product
capabilities:

- MCP registers a Terminay stdio server with supported agent clients and gives
  processes launched inside a Terminay terminal a project-scoped control
  capability.
- The Agents sidebar and terminal agent status continue to come from
  process-bound provider journals and logs as specified in
  [agent-status-and-sidebar.md](./agent-status-and-sidebar.md).
- Installing, enabling, disabling, or removing Terminay MCP never installs,
  edits, trusts, invokes, or removes Codex or Claude Code hooks.

## Product outcomes

- A user can install or remove the Terminay MCP registration for Claude Code,
  Codex, Cursor CLI, Gemini CLI, and OpenCode independently.
- Once installed, an agent launched normally inside a Terminay terminal can use
  Terminay tools without copying a socket path or token.
- The agent can list and control only terminals belonging to the calling
  terminal's canonical project.
- MCP remains usable when no renderer is attached and across renderer reloads.
- MCP installation does not affect how Terminay discovers or displays agents.

## Ownership and boundaries

Terminay Server owns the MCP stdio entry point, local control endpoint,
capability issuance and revocation, scope resolution, terminal operations,
subscriptions, and workspace mutations. It resolves operations directly
against canonical server-owned project and terminal state. A renderer is never
an authority or routing hop.

The control endpoint is local to the server machine. It does not use WebRTC,
remote-device credentials, browser storage, or the hosted signalling service.
It uses a user-only Unix domain socket or the platform-equivalent local IPC
transport and never listens on a TCP interface.

The initial capability is available only to project environments that can
provide a proven server-local control transport. An environment that cannot
provide that transport reports MCP unavailable. It never falls back to the
local machine or a similarly named project or terminal. A remote environment
may support MCP only through an authenticated environment bridge that preserves
the same project and session scope.

## Installation and registration

Terminay exposes an **Install Terminay MCP** action. Its management surface:

- detects the registration state for each supported agent;
- distinguishes not installed, installed, changed, unavailable, and error
  states;
- installs and removes Claude Code, Codex, Cursor CLI, Gemini CLI, and OpenCode
  independently; and
- identifies the provider-owned configuration scope being changed.

Registration uses the provider's supported MCP configuration contract or CLI.
Terminay creates only its own named `terminay` stdio-server entry. The entry
contains the stable command and arguments needed to start the packaged Terminay
MCP adapter; it contains no terminal capability token, socket path, provider
secret, project path, or hook configuration.

Installation safety requirements:

- Unrelated provider configuration is preserved.
- Removal deletes only the Terminay-owned MCP entry.
- A matching entry is treated as already installed.
- An existing but changed `terminay` entry is shown for review and is not
  overwritten silently.
- Writes are atomic when Terminay writes configuration directly.
- Provider configuration parse or validation failures never cause a destructive
  rewrite.
- Diagnostics redact secrets and do not include unrelated provider
  configuration.
- Registration does not grant blanket tool approval or alter the provider's
  normal MCP trust and approval policy.
- No install, uninstall, detection, or repair path reads or writes provider hook
  configuration.

Provider configuration formats and commands can change independently of
Terminay. Provider-specific registration adapters are versioned and tested
against their current supported contracts rather than sharing parsing logic
with agent-status journal drivers.

CI runs a Docker-isolated compatibility test with the supported agent CLIs
installed. The test gives Terminay a container-only home directory, registers
the packaged stdio command through the same privileged adapters used by the
application, and requires each real CLI to load and report the `terminay`
registration. It needs no provider credentials, never uses the host home
directory, and fails when a client stops accepting Terminay's configuration
contract.

Terminay registers each client in its supported user-wide scope so the adapter
is available to agents launched from any Terminay project:

| Client | Registration contract |
| --- | --- |
| Claude Code | The `terminay` entry in `mcpServers` in `~/.claude.json`. |
| Codex | The `[mcp_servers.terminay]` table in `~/.codex/config.toml`, including an `env_vars` whitelist for the inherited `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN` capability variables. |
| Cursor CLI | The `terminay` entry in `mcpServers` in `~/.cursor/mcp.json`, shared with Cursor's user-level MCP configuration. |
| Gemini CLI | The `terminay` entry in `mcpServers` in the user settings file `~/.gemini/settings.json`; the entry retains Gemini's normal per-tool confirmation policy. |
| OpenCode | The `terminay` local server in `mcp` in the active stable user configuration under `~/.config/opencode/`, using a command array and no trust or permission override. |

When a provider supports multiple user configuration filenames, Terminay uses
the existing supported file without creating a competing file. If more than
one candidate exists and there is no unambiguous provider precedence contract,
Terminay reports the registration unavailable for review. Unsupported syntax,
including a configuration dialect Terminay cannot safely round-trip, is also
reported as unavailable without rewriting the file.

## Enablement

Settings contains an **Enable Terminay MCP server** switch.

Disabling MCP stops accepting new requests and cancels or rejects active
requests, revokes live capabilities, and prevents new terminals from receiving
one. It does not remove provider registration. Re-enabling affects subsequently
launched terminals and may issue fresh capabilities to eligible live terminals
only when their exact canonical identity can be retained safely.

MCP enablement is independent from **Agent status and sidebar**. Either feature
can be enabled while the other is disabled. Changing one setting cannot mutate
the other setting or its provider configuration.

## Scope and capability lifecycle

Each eligible terminal receives protected launch-environment values identifying
the local control endpoint and a random per-terminal capability token. Child
processes can inherit those values because they already execute with the
calling terminal's shell authority. Terminay explains this implication where
MCP is enabled.

Presenting a token resolves to the immutable calling terminal and its canonical
project. A token:

- grants access only to terminal panels in that project;
- never enumerates project identity as an MCP tool concept;
- cannot address another project or server;
- is replaced or revoked atomically when its terminal changes project;
- is revoked on terminal exit, explicit revocation, server shutdown, or MCP
  disablement; and
- cannot be widened using a title, panel id, cwd, active tab, renderer state,
  process name, or copied metadata.

Raw tokens are protected at rest and excluded from logs, snapshots, settings,
client messages, diagnostics, and MCP results.

## Local protocol

The stdio adapter starts with the agent client and reads its connection details
from the inherited terminal environment. It validates the endpoint and token
before advertising tools and exits cleanly when stdin closes or authority is
revoked.

Control requests and responses are correlated, framed, size-bounded, and
runtime-validated. Concurrency, request lifetime, output size, and pending waits
are bounded. Invalid tokens and malformed requests return bounded failures that
do not reveal valid scopes. Cancellation reaches the terminal operation, and
an aborted request cannot start a later backend mutation or publish a stale
result.

The server dispatches validated operations through an explicit
operation-to-handler table. Handlers receive immutable resolved scope and a
cancellation signal, never the raw token. Unsupported operations return a
stable unsupported error rather than falling through to a renderer or local
fallback. Unexpected failures become bounded generic errors.

## Tool surface

Terminay exposes the following project-implicit tools:

| Tool | Behaviour |
| --- | --- |
| `get_mcp_capabilities` | Reports the globally available MCP operations for the bound host before an agent calls an optional operation. |
| `list_terminals` | Lists terminal panels in scope with opaque handles, display names, state, and active status. |
| `read_terminal` | Reads either a bounded, lossless raw-output range or a bounded current terminal-presentation snapshot. |
| `search_terminal` | Searches a bounded current text presentation snapshot and returns bounded matching visual-row context. |
| `get_terminal_status` | Returns canonical activity, attention, cwd, and last-exit information. |
| `write_terminal` | Writes exact validated text to one live terminal. |
| `run_command` | Writes one command and submits it once, using bracketed paste for multiline input. |
| `open_terminal` | Creates a terminal in the same project with an optional display name and policy-valid cwd. |
| `close_terminal` | Closes one terminal through normal terminal lifecycle rules. |
| `focus_terminal` | Makes one terminal active in the logical workspace view without stealing focus in an unrelated client. |
| `rename_terminal` | Changes one terminal's display title. |
| `split_terminal` | Creates a split relative to one terminal. |
| `wait_for_idle` | Waits for bounded canonical terminal inactivity. |
| `wait_for_command` | Waits for the next structured command completion and returns bounded exit information. |
| `wait_for_attention` | Waits for the next canonical needs-attention signal. |

Names are conveniences, not identities. An ambiguous name returns bounded
candidates instead of choosing one. Tool results never expose capability
tokens, filesystem secrets, other projects, or other server connections.

## Reading, presentation, and searching

Terminal output has two deliberately different MCP representations. A raw
stream position is a non-negative byte position in the PTY-output stream; it
is not a screen-row, command, or presentation cursor. Presentation rows are
stateful: cursor movement, erasure, wrapping, and resize can change an earlier
row. Terminay therefore never represents a raw-stream range as an exact range
of rendered rows.

Every terminal exposes `replay_from`, the first retained raw byte position,
and `output_position`, the exclusive position after the most recently accepted
output byte. They are canonical server-owned positions, are scoped to one
terminal session, and are invalid after that session is gone.

### Raw output ranges

`read_terminal` with `format: "raw"` is the lossless cursor and pagination
operation. Its input is:

```text
{ terminal, format: "raw", after?: position, max_bytes?: integer }
```

`after` means the raw-stream position immediately after bytes the caller has
already consumed. The returned range is `[from, next)`. Omitting `after`
starts at `replay_from`; supplying the preceding response's `next` continues
without resending retained bytes. `after` greater than `output_position` is an
invalid request. If `after` precedes `replay_from`, the response begins at
`replay_from` and sets `history_lost: true`; it never silently substitutes a
tail while claiming that the requested history was available.

The raw payload is exact PTY bytes encoded as Base64, never as a lossy decoded
JavaScript string. Its response contains the required fields:

```text
{
  terminal, format: "raw", encoding: "base64", output,
  from, next, replay_from, output_position,
  history_lost, truncated_tail
}
```

`truncated_tail` means more retained raw output existed at the captured
`output_position` than fits the requested response budget; `next` remains the
exclusive position of the emitted bytes, so the caller can page forward. A
response with no available bytes has `from === next`. `history_lost` is
distinct from pagination and from a presentation that was shortened to fit.

### Current presentation snapshots

`read_terminal` with `format: "text"` or `format: "ansi"` reads the current
canonical emulated terminal presentation, including its bounded retained
scrollback, not a raw-output delta. These formats reject `after`.

`text` returns plain visual rows from the current emulator. A visual row is a
single xterm buffer row at the snapshot geometry, including a wrapped portion
of a logical line; row strings contain no terminal control sequences. `lines`,
when present, selects the most recent visual rows. `ansi` returns an ANSI
serialization of the same emulated presentation, suitable for recreating that
presentation; it is not a decoding of raw PTY bytes. Both responses report
the captured `output_position` and `dimensions`, and state whether older
presentation content was omitted to meet a row or payload budget.

Presentation snapshots can contain rows already returned by an earlier
snapshot. This is intentional: they describe a current screen state, not an
append-only transcript. Agents use raw ranges when they require cursor-based,
non-repeating delivery.

### Response budgets

All output operations take `max_bytes`, defaulting to 16 KiB. It bounds the
UTF-8 byte length of the returned representation: Base64 characters for
`raw`, text rows for `text`, and serialized ANSI text for `ansi`. The public
maximum is 64 KiB, reserving space below the control endpoint's 256 KiB
response limit for JSON, result fields, and MCP framing. The implementation
also measures the complete serialized control and MCP result and reduces the
payload if necessary; a valid output read never fails only because output is
large.

Raw pagination selects only complete emitted Base64 quanta and advances
`next` by exactly the decoded raw bytes. Text and ANSI presentation reads omit
whole oldest rows or a complete valid presentation fragment rather than
splitting a UTF-8 character or terminal control sequence, and report
`presentation_truncated: true`. Validation, authority, cancellation, and
terminal-lifecycle failures remain errors; the no-size-failure rule applies
only to a valid output payload.

### Presentation search

`search_terminal` is separate from `read_terminal`. It searches the current
emulated text presentation, never raw bytes or ANSI source. Its input is:

```text
{
  terminal, query,
  case_sensitive?: boolean,
  context_lines?: integer,
  max_matches?: integer,
  max_bytes?: integer
}
```

`query` is a non-empty literal Unicode string, not a regular expression. The
default is case-sensitive matching; when `case_sensitive: false`, matching
uses Unicode simple case folding. `context_lines` defaults to 2 and is capped
at 20. `max_matches` defaults to 20 and is capped at 100. Matches are ordered
from the oldest retained visual row to the newest and each includes its row
text and up to the requested preceding and following visual rows. Row indexes,
when returned, identify this one snapshot only and are not cursors.

Search uses the same 16 KiB default and 64 KiB maximum result budget as a
read, scans only the terminal's bounded retained presentation, and reports
the captured `output_position`, `dimensions`, `matches_truncated`, and
`presentation_truncated`. It shortens context before omitting later matches,
and never lets a large match set exceed the response budget.

## Writing, command submission, and waiting

Writes target an exact immutable terminal session, fail after exit or
revocation, and pass through the same authorization, recording, activity,
input-ordering, and backpressure boundaries as other non-interactive terminal
input. Multiline commands use the terminal's established paste and submission
semantics.

`run_command` returns:

```text
{ terminal, command_id, from, submitted_bytes, submitted: true }
```

`command_id` uniquely identifies this accepted MCP submission; it is not a
shell command identity and does not identify an activity event or exit status.
`from` is the terminal's raw `output_position` captured immediately before the
write is accepted. It is a lower bound for observing output after submission,
not proof that bytes in a later raw range were produced by that command:
prompts, background jobs, and other writers can interleave. `submitted_bytes`
is the exact number of PTY input bytes written, including the bracketed-paste
wrapper and submission carriage return when used. It replaces the ambiguous
`bytes` field.

Wait tools observe canonical server-owned terminal activity. They return on
their matching condition, terminal exit, timeout, cancellation, capability
revocation, or server shutdown. A renderer reload or disconnected client does
not interrupt a wait.

`wait_for_command` observes the next host-supported structured command
completion; it is not correlated to `run_command.command_id`. Hosts that lack
structured command-completion or attention observation report that fact before
the operation is called rather than implying an exit status is available.

## Tool availability and response conformance

`get_mcp_capabilities` is always available after capability validation. It
returns an adapter-global list of tool names and `available` booleans for the
bound host. Availability is not a property of an individual terminal row.
An unavailable optional tool may remain in the MCP registration for a stable
client surface, but a caller can discover it through this result and calls to
it return `unsupported_op` without side effects.

Desktop and standalone-server adapters share required response fields and
their meanings. For terminal listings and status, the common contract includes
the opaque `terminal`, canonical `status`, `output_position`, and
`replay_from`; output and search responses additionally follow the format
contracts above. A host may add documented presentation metadata such as a
display name, local launch cwd, activity, attention, active state, or
host-specific status detail. Conformance tests assert the required common
contract and prohibit conflicting meanings, rather than requiring identical
host-extension shapes.

## Security and privacy

- MCP v1 exposes terminal control only; filesystem, Git, settings, secrets,
  recordings, extension administration, remote administration, and arbitrary
  native-window management remain outside the tool surface.
- Every request revalidates its capability against canonical terminal and
  project state.
- Output, parameters, errors, candidate lists, and waits are bounded to resist
  memory and context exhaustion.
- The server does not infer authority from current UI focus or renderer
  ownership.
- Installing the MCP entry does not enable provider hooks or disclose provider
  journals.
- Journal records used for agent status are never routed through MCP and MCP
  calls never synthesize agent-status lifecycle events.

## Failure behaviour

- Missing, changed, or invalid provider registration is reported without
  changing provider configuration.
- A missing local endpoint or inherited capability makes the MCP adapter
  unavailable; it never broadens scope or attempts network discovery.
- Closing or moving the calling terminal, disabling MCP, or restarting the
  server invalidates stale authority immediately.
- A renderer failure cannot redirect, authorize, or keep alive an MCP request.
- Provider registration can remain installed while the Terminay server is
  stopped or MCP is disabled; the provider receives an ordinary bounded server
  startup or connection failure.

## Acceptance tests

1. Claude Code, Codex, Cursor CLI, Gemini CLI, and OpenCode registrations install
   and uninstall independently while preserving unrelated provider
   configuration.
2. Install, uninstall, enable, disable, and repair operations create no provider
   hooks and do not mutate provider hook, trust, or agent-status configuration.
3. MCP and agent-status settings operate independently in all four enabled and
   disabled combinations.
4. An installed agent inside a Terminay terminal can list and control only
   sibling terminals in its exact canonical project.
5. A copied token, title, panel id, cwd, or terminal name cannot cross project,
   environment, or server boundaries.
6. Reads work without an attached renderer and pending waits survive renderer
   reload.
7. Writes use the canonical terminal input boundary, including correct
   multiline command submission.
8. Disablement, terminal exit, project transfer, and server shutdown revoke old
   capabilities and release pending waits.
9. The local endpoint never listens on a network interface and rejects
   malformed, oversized, unauthenticated, stale, and cross-scope requests.
10. Packaged Desktop and standalone-server artifacts start the same bounded
    stdio MCP adapter using their supported runtime layout.
11. Electron end-to-end coverage runs only through `npm run test:e2e`.
12. Deterministic MCP coverage exercises parser edge cases, Unicode and binary
    output, cursor retention and pagination, complete serialized response
    bounds, invalid format/parameter combinations, global capability reporting,
    and required-common Desktop/standalone adapter conformance.
13. Docker compatibility coverage installs every supported agent CLI, registers
    Terminay in an isolated user scope, and proves that each CLI recognizes the
    registration without provider credentials or host configuration access.

## Non-goals

- Provider hooks of any kind.
- Agent lifecycle detection, Agents sidebar population, or terminal agent-status
  inference.
- Cross-project or cross-server terminal control.
- A public or remotely discoverable network MCP endpoint.
- Filesystem, Git, settings, recording, secret, extension-management, or
  remote-access tools.
- Trust based on terminal title, process name, cwd, active UI focus, or renderer
  state.
