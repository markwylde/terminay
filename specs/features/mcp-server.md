# Terminay MCP Server Specification

## Summary

Terminay provides a local Model Context Protocol server for Codex and Claude
Code processes running inside Terminay terminals. An installed agent can
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

- A user can install or remove the Terminay MCP registration for Codex and
  Claude Code independently.
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
- installs and removes Codex and Claude Code independently; and
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
| `list_terminals` | Lists terminal panels in scope with opaque handles, display names, state, and active status. |
| `read_terminal` | Reads bounded recent output or a bounded range from one terminal. |
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

## Reading, writing, and waiting

Output reads use the server's bounded terminal replay state rather than a
client xterm instance. Requests declare byte or line limits and return
truncation metadata. Reading preserves terminal data as text and does not
execute it.

Writes target an exact immutable terminal session, fail after exit or
revocation, and pass through the same authorization, recording, activity,
input-ordering, and backpressure boundaries as other non-interactive terminal
input. Multiline commands use the terminal's established paste and submission
semantics.

Wait tools observe canonical server-owned terminal activity. They return on
their matching condition, terminal exit, timeout, cancellation, capability
revocation, or server shutdown. A renderer reload or disconnected client does
not interrupt a wait.

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

1. Codex and Claude Code registrations install and uninstall independently
   while preserving unrelated provider configuration.
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
