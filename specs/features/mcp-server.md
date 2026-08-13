# Terminay MCP server

## Summary

Terminay provides a local Model Context Protocol server for coding agents that
run inside a Terminay terminal. The agent can inspect and control sibling
terminals in its own project without learning about other projects, workspace
views, servers, or clients.

The MCP surface is terminal-focused and project-implicit. A process inherits
its authority from the exact Terminay terminal session in which it runs.

## Ownership

Terminay Server owns the MCP stdio entry point, local control socket,
capability tokens, scope resolution, terminal operations, subscriptions, and
workspace mutations. The server resolves operations directly against its
canonical project and terminal model; no renderer is an authority or routing
hop.

The control socket is local to the server machine. It does not use WebRTC,
remote device credentials, browser storage, or the hosted signaling service.

That socket is available to This server terminals only. SSH/Puzed shells never
receive a Terminay Server-local socket path or capability token in their launch
environment. Remote MCP requires a future authenticated project-environment
bridge/helper capability; without it MCP is visibly unavailable and never
targets local sibling sessions as a fallback.

The server dispatches each validated operation through an explicit
operation-to-handler table. A handler receives the immutable terminal/project
scope and request cancellation signal, never the raw capability token. An
operation that is not enabled returns the stable `unsupported_op` error rather
than falling through to a renderer or an implicit fallback. Typed terminal
errors preserve their bounded public code/message/candidate shape; unexpected
handler failures become a generic `internal` error.

The typed adapter validates every tool parameter before invoking its
server-owned implementation. Text, names, paths, and wait durations have
explicit bounds; write/run/read/open/split/wait handlers receive the same
abort signal as the socket request; and an aborted request cannot start a
backend operation or publish its result. Scope failures are returned as
`forbidden` without invoking the operation.

The composed server terminal adapter resolves list/read/status/write/run/open
and close directly against `TerminalService`, filtering every target by the
capability's implicit project. Reads use the bounded replay buffer and writes
use the same PTY input boundary as other server writers. When
`TerminalActivityService` is present, idle, command-completion, and attention
waits subscribe to its canonical ordered snapshots with bounded deadlines;
without that service those waits fail closed as unsupported. Focus, rename, and
split remain host-provided view mutations until the server workspace view
authority is composed.

The headless stdio adapter advertises those bounded schemas to MCP clients and
returns failed calls as `isError` results with a stable structured
`error.code`, bounded message, and optional terminal candidates. It validates
the inherited socket path and capability before starting, caps local
in-flight calls and framed request/response bytes, and closes its local socket
when the MCP host closes stdin.

## User experience

- The Command Bar contains **Install Terminay MCP**.
- The install window detects supported agents and reports installed,
  not-installed, changed, unavailable, and error states.
- Claude Code and Codex can be installed or uninstalled independently.
- Installation preserves unrelated user-owned provider configuration.
- Settings contains an **Enable Terminay MCP server** switch.
- Disabling the switch rejects new and active MCP operations without changing
  the provider's installed configuration.
- An agent started inside a Terminay terminal receives the MCP connection
  automatically after installation; the user does not copy socket paths or
  tokens manually.

## Scope and capability

Each terminal receives:

- `TERMINAY_CONTROL_SOCKET`, an absolute path to the server's local control
  endpoint; and
- `TERMINAY_CONTROL_TOKEN`, a random per-terminal capability token.

The server stores only a secure token digest or otherwise protects the token at
rest. Presenting the token resolves to the immutable calling terminal and its
owning project.

The token grants access only to the terminal panels in that project:

- it does not enumerate project identity as an MCP concept;
- it cannot address another project or server;
- moving the calling terminal to another project changes or revokes its
  capability according to one atomic server mutation;
- terminal exit, explicit revocation, server shutdown, and disabling MCP revoke
  the token; and
- copied titles, panel ids, current focus, cwd, and renderer state do not widen
  scope.

Child processes can inherit the token because they already execute with the
calling terminal's shell authority. Terminay presents this implication clearly
when MCP is enabled.

## Local transport

- The control endpoint is a user-only Unix domain socket or the platform
  equivalent.
- Socket files and parent directories use the strictest practical user-only
  permissions.
- The endpoint never binds a TCP interface.
- Requests and responses are framed, size-bounded, runtime-validated, and
  correlated.
- Invalid tokens and malformed messages receive a generic failure that does
  not reveal valid scopes.
- Slow readers, abandoned waits, oversized payloads, and excess concurrent
  requests are bounded.

The `terminay mcp` command is a headless stdio MCP adapter. It reads the socket
and token from its environment, connects locally, exposes the supported MCP
tools, and exits cleanly when stdin closes or the server revokes access.

## Tool surface

Terminay exposes:

| Tool | Behaviour |
| --- | --- |
| `list_terminals` | Lists terminal panels in the calling terminal's project with stable opaque handles, display names, state, and active status. |
| `read_terminal` | Reads a bounded recent output snapshot or a bounded range from one visible terminal. |
| `get_terminal_status` | Returns canonical activity, attention, cwd, and last-exit information for one visible terminal. |
| `write_terminal` | Writes exact text to one visible live terminal after validation. |
| `run_command` | Writes one command and submits it once, using bracketed paste for multiline content. |
| `open_terminal` | Creates a terminal in the same project with an optional safe display name and cwd inherited or validated within project policy. |
| `close_terminal` | Closes one visible terminal using normal terminal lifecycle rules. |
| `focus_terminal` | Marks one visible terminal active in the logical workspace view without stealing focus on an unrelated client. |
| `rename_terminal` | Changes one visible terminal's display title. |
| `split_terminal` | Creates a terminal split relative to a visible terminal. |
| `wait_for_idle` | Waits for a bounded period of terminal inactivity. |
| `wait_for_command` | Waits for the next structured command completion and returns its exit information. |
| `wait_for_attention` | Waits for the next canonical needs-attention signal. |

Names are conveniences, not identity. Ambiguous names return candidates rather
than choosing arbitrarily. Tool results never include raw capability tokens,
filesystem secrets, other projects, or other server connections.

## Reading and writing

- Output reads use the server's bounded terminal replay buffer, not a client
  xterm instance.
- Requests declare byte/line limits and return truncation metadata.
- Reads preserve terminal data as text without executing it.
- Writes target the exact immutable terminal session and fail if it has exited.
- Writes pass through the same recording, activity, authorization, and
  backpressure boundaries as keyboard, macro, dictation, and remote input.
- MCP cannot write to its own or another terminal after its calling capability
  is revoked.

## Waiting and events

The three wait tools return on their matching condition, terminal exit,
timeout, cancellation, or capability revocation.

The server evaluates events from its canonical terminal activity state. A
renderer reload or disconnected client does not interrupt the wait.

Each wait has a maximum lifetime, can be cancelled, and is released on token
revocation, target exit, or server shutdown.

## Installation safety

- Provider configuration is parsed and written atomically.
- Terminay changes only its own named MCP entry.
- Existing unrelated entries, formatting-relevant data, permissions, and
  unsupported keys are preserved.
- Uninstall removes only the Terminay-owned entry.
- A changed entry is shown for review rather than overwritten silently.
- Install diagnostics redact tokens, terminal data, and unrelated provider
  configuration.

## Security

- MCP v1 is enabled only for This server project environments and its control
  socket is never network-exposed.
- One random token maps to one calling terminal and one implicit project scope.
- Every request revalidates that scope against canonical server state.
- File, Git, settings, secrets, recordings, remote administration, and
  cross-project window management are outside the MCP tool surface.
- Output and errors are bounded to avoid memory and context exhaustion.
- Raw tokens are excluded from logs, snapshots, settings, and client messages.
- Remote users cannot request or install a usable local control token on their
  own device.

## Non-goals

- No filesystem, Git, settings, recording, secret, or remote-access MCP tools.
- No cross-project or cross-server control.
- No network MCP endpoint.
- No arbitrary native window management.
- No trust based on terminal title, process name, cwd, or active UI focus.

## Acceptance outcomes

- An installed Claude Code or Codex process inside a Terminay terminal can list
  and control only sibling terminals in its own project.
- The same operation cannot see or address terminals in another project,
  workspace view, or server.
- MCP reads work without an attached xterm client.
- An outstanding wait survives renderer reload and ends on its event, timeout,
  cancellation, target exit, or capability revocation.
- Disabling MCP or closing the calling terminal immediately prevents later
  operations with the old token.
- Install and uninstall preserve unrelated provider configuration.
- The socket never listens on a network interface and rejects malformed,
  oversized, unauthenticated, stale, or cross-scope requests.
