# Agent Status and Agents Sidebar Specification

## Summary

Terminay observes supported coding-agent session journals and reduces their
native records into provider-neutral agent entries. A journal is authoritative
only after Terminay binds it to the exact server-owned PTY through that
provider's documented terminal identity evidence.

The same canonical model feeds terminal-tab status, a project-scoped **Agents**
pane with roots and in-process subagents, and the header activity dropdown.
Raw terminal signals remain a lower-confidence fallback when a supported
journal cannot be discovered or parsed. See
[terminal-activity-signals.md](./terminal-activity-signals.md).

## Ownership and privacy

Journal discovery, process binding, incremental reading, driver selection,
provider normalization, canonical snapshots, acknowledgement, and
terminal/project mapping live in Terminay Server. Connected clients subscribe
to the same ordered reduced snapshot. Clients never read provider journals or
create competing agent state.

Provider journals are private privileged inputs. Their raw records, prompts,
responses, instructions, reasoning, tool arguments, and tool output never cross
the server boundary and are never logged by the integration.

Foreground-process and journal discovery are project-environment capabilities.
This server may use the native process tree. An SSH/Puzed environment without a
proven remote source retains generic terminal activity but reports authoritative
agent observation unavailable; the local SSH client PID or local provider home
can never establish ownership of a remote journal.

## Product outcomes

- Running `codex`, `claude`, or `omp` normally in an interactive Terminay
  terminal is discovered without editing provider configuration or installing
  global integrations.
- Agent state remains associated with the exact terminal the user can activate.
- Provider file formats and versions stay out of client components and stores.
- Newer compatible provider versions reuse the latest known mapping.
- Unsupported, missing, malformed, or ephemeral journals degrade safely to
  terminal activity.

## Canonical model

The canonical providers are `codex`, `claude-code`, and `omp`. Each has a
versioned driver and a process-bound journal source. Display names are Codex,
Claude Code, and omp. A fourth CLI cannot appear until its driver and source
are specified and implemented.

| State | Meaning | Indicator |
| --- | --- | --- |
| `working` | The agent is processing a turn or performing tool/subagent work. | Yellow/amber, with restrained motion. |
| `waiting` | The provider explicitly requests approval, an answer, or other user input. | Red. |
| `blocked` | A supported record explicitly reports a blocking condition. | Red, with an accessible label distinct from waiting. |
| `done` | The current turn or agent run completed, failed, or was cancelled. | Green. |
| `idle` | The live session exists without active work or a pending result to emphasize. | Neutral or hidden on compact surfaces. |

Acknowledgement is independent of operational state. Viewing an entry clears
its unread treatment without rewriting its provider-derived state. A later
meaningful transition can make it unread again.

A root represents one live provider session bound to a Terminay PTY. A
provider-native child is represented beneath that root and normally activates
the same terminal. Stable native session, turn, child, and agent IDs are used
when available; display text is never an identity key. Child transitions do
not replace root state, and a child stop updates only that child.

## Exact terminal identity

For an environment exposing proven native process observation, Terminay records
the spawned shell PID for the immutable
`serverId`/`projectId`/`projectEnvironmentId`/`sessionId` terminal identity.
When a supported provider becomes the foreground process, that environment's
privileged host obtains its documented terminal identity evidence. Codex uses
an eligible writable journal below the exact PTY process tree. Claude Code and
omp use their provider-specific terminal/session association. Environments
without the required evidence use the documented terminal-activity fallback.

The terminal/process-tree boundary is immutable for one live provider-process
incarnation, but its root-session binding is renewable. Provider-native
`/resume` or session switching moves authority to the root journal receiving
the newest current-session activity, retires the previous root, and replays the
new root in the same activation terminal. A resumed provider session may also
reopen the same journal in another terminal; that writer creates a new binding
incarnation and activation terminal without allowing stale events from the
previous incarnation to mutate it.

The Codex launcher may expose a generic wrapper such as `node` as the PTY
foreground process. A shebang-run `omp` on macOS may likewise expose `bun`.
Every transition away from the shell therefore starts a new bounded
journal-discovery window even when the foreground name is not a recognized
provider. This lets a resumed session launched long after terminal startup
bind its reopened journal without treating the wrapper itself as an agent.
The journal is still admitted only after the provider's documented identity
evidence is proven. An `omp` binary that sets its process title still matches
`omp` directly; a `bun` wrapper is admitted only after the OMP terminal
breadcrumb for the exact PTY identifies a validated OMP root JSONL.

CWD, filename timestamps, terminal title, active tab, and “closest match” logic
must not independently establish an authoritative binding. Claude Code uses its
exact descendant process CWD to establish the native project journal directory
and post-process-start root writes to select the active session. OMP uses its
own terminal-scoped breadcrumb, whose terminal ID is derived from the PTY TTY
that runs OMP and whose target is validated under OMP's allowed session root.
A host that cannot establish provider proof uses terminal fallback instead.

## Journal source contract

A provider journal source:

1. obtains provider-specific terminal-to-journal identity evidence beneath the
   effective provider home;
2. proves that evidence belongs to the registered PTY shell process or its
   terminal TTY;
3. reads a bounded initial window and then only appended bytes;
4. buffers an incomplete final JSONL line until it is completed;
5. detects truncation, atomic replacement, provider session switch, writer exit,
   and process-incarnation change;
6. emits raw records only to the selected privileged driver;
7. stops all file/process observation when the terminal, integration, or server stops.

Discovery is retried briefly after terminal startup and whenever the shell
loses foreground because either transition can arrive before the journal is
opened. Once a supported provider is known to be foreground, discovery remains
armed until that incarnation is bound or leaves the foreground. Expensive
open-file/process inspection is used for initial binding, not for every
appended record. Symlinks, non-regular files, paths outside the canonical
sessions root, oversized records, invalid JSON, and unbounded growth are
handled defensively.

## Versioned driver contract

The driver abstraction is identified by `(provider, mappingVersion)`, for
example `(codex, 0.1)`. A driver recognizes session metadata, maps a strict
allowlist of native records to canonical lifecycle events, and reads only
bounded lifecycle/display metadata. It never focuses UI, infers terminal
ownership, reads arbitrary paths, mutates the store directly, or exposes raw
records.

Mapping versions describe Terminay parsers. Provider CLI versions are
normalized to major/minor. The registry chooses the greatest mapping version
less than or equal to the running provider version. A provider newer than all
known mappings uses the newest mapping optimistically; one older than all
mappings uses the oldest. Unknown records are ignored so additive changes are
compatible.

Each mapping has provider-owned JSONL fixtures and contract tests. A
compatibility script runs a candidate provider-version fixture against the
mapping the registry would select. Passing means no new mapping is required;
semantic failure requires a new mapping and fixtures without changing earlier
mappings.

## Codex journal mapping

Codex sessions live below the effective `CODEX_HOME/sessions` root; when
`CODEX_HOME` is unset, the host account's `.codex/sessions` root is used. Shell
snapshots are startup artifacts and are not lifecycle sources.

The first supported mapping is `(codex, 0.1)`. It accepts later Codex versions
until a divergent mapping is added. The initial `session_meta` provides the
stable provider session ID, CLI version, source, and bounded metadata. A
rollout is eligible as the terminal's root only when that metadata identifies
`originator: codex-tui` and `source: cli`. Provider-native subagent sources
remain in-process children of that root and must not compete with root rollouts
during process-bound discovery. When one writer holds multiple eligible root
rollouts, such as after resume or branch, the most recently modified eligible
root is selected.

| Codex record | Canonical result |
| --- | --- |
| root `session_meta` with `originator: codex-tui` and `source: cli` | root `session.started` / `idle` |
| `event_msg/item_completed` carrying a `UserMessage`, or legacy `event_msg/user_message` | the first user-facing message becomes the stable root prompt label, matching Codex's own session-list derivation; raw `response_item` messages are ignored |
| `event_msg/item_completed` carrying a `CollabAgentToolCall` | fan out its bounded receiver identities and state map into child lifecycle events |
| model-context user item such as `<turn_aborted>` | ignored for naming |
| `event_msg/task_started` | root `turn.started` / `working` |
| tool/item begin or callable response item | corresponding root or child `working` |
| execution/patch/permission approval request | corresponding entry `waiting` |
| `event_msg/request_user_input` or elicitation request | corresponding entry `waiting` |
| matching response/resolution or subsequent progress | finish the wait and resume `working` |
| `event_msg/task_complete` | corresponding entry `done` |
| error or aborted completion | `done` with error/cancelled outcome unless explicitly blocking |
| `collab_agent_spawn_end` | create the matching child from `new_thread_id`, bounded nickname/role/task, model, and sender parent identity |
| collaboration interaction/resume and path activity | create or resume the matching child; prefer nickname, role, then the final path segment for its label |
| collaboration completion, error, or interruption | mark only the matching child done with a success, error, or cancelled outcome and retain it for acknowledgement |
| collaboration close or shutdown | retire only the matching child from the live tree |
| `event_msg/shutdown_complete` or confirmed writer/process exit | root inactive |

Sequence numbers come from accepted record order within one binding
incarnation. Provider timestamps are used only when valid. Replayed initial
windows and repeated records cannot rewind an entry.

While Codex remains in the foreground, Terminay revalidates the rollout held
open by that exact process tree. Opening a different eligible root rollout
switches the tail, retires the previous root, and replays the fresh or resumed
session.

Claude Code uses the same zero-injection boundary. Terminay binds an exact
`claude --resume <uuid>` descendant to that UUID's root JSONL below the project
directory in `~/.claude/projects`. For a new `claude` process it admits only one
root journal created for the exact process working directory after that process
started. An open writable root journal remains an eligible fallback;
`subagents/` journals and unrelated history are not eligible roots. It uses
explicit `ai-title` records for the root label, assistant model metadata,
bounded tool lifecycle, and `Agent` tool use/result pairs for named child
lifecycle. Meta/local-command user records, tool-result content, assistant
text, and reasoning are never projected.

## omp journal mapping

omp sessions live below the effective agent sessions root. When
`PI_CODING_AGENT_DIR` is unset and no named `OMP_PROFILE` / `PI_PROFILE` is
active, that root is `~/.omp/agent/sessions`. A named profile relocates the
agent directory. Linux XDG data relocation after `omp config migrate` is
honored. History SQLite, blob stores, debug logs, daemon sockets, RPC/ACP,
and collab websockets are not lifecycle sources.

The first supported mapping is `(omp, 0.1)`. It accepts later omp session
versions until a divergent mapping is added. Physical JSONL files begin with a
fixed 256-byte `type: "title"` slot. Terminay skips that slot before any
session-identity check. The logical first record must be `type: "session"`
with a stable `id`. A physical first line of `type: "title"` is never a
session-identity record and never satisfies a Codex `session_meta` check.

A root journal is a `*.jsonl` file whose parent directory is an encoded-cwd
directory under the sessions root, not a nested artifacts directory of another
session file. Child journals live beside the parent as
`<parent-stem>/<agentId>.jsonl`. They are in-process children of that root and
must not compete with root journals during process-bound discovery. When one
writer holds multiple eligible root journals, the most recently modified
eligible root is selected.

OMP writes a terminal-scoped breadcrumb below its effective agent data root:
`terminal-sessions/<terminal-id>`. The identifier is derived from the OMP
process's TTY, and the breadcrumb records its CWD, exact session-file path, and
an optional `fresh` marker. Terminay derives the same ID from the registered
PTY shell's TTY, accepts only a bounded well-formed breadcrumb whose target is
a validated root JSONL below an allowed OMP sessions root, and rechecks it while
OMP remains foreground. A `fresh` breadcrumb whose JSONL is not yet materialized
keeps terminal-activity fallback until the target exists. A changed breadcrumb
rebinds the same terminal to the newly validated root. CWD, filename timestamps,
and newest-file heuristics never establish ownership. Open-FD observation is
supplementary evidence only.

A brand-new interactive session remains memory-only until the first assistant
message is persisted or the process forces the file onto disk. Until that
file exists, the terminal stays on terminal-activity fallback. That is omp's
durability model, not a binding failure. Streaming tokens are not on disk
until the completed message is appended, so the sidebar reports working or
done from durable records and never reconstructs token-by-token text.

omp has no Codex-style approval or elicitation journal record. `waiting` and
`blocked` are used only when a supported record explicitly requests user
input. Permission prompts therefore remain `working` while the process is
alive. Title-only slot rewrites do not change file size and are not required
for lifecycle.

| omp record | Canonical result |
| --- | --- |
| logical `type: "session"` header after skipping the title slot | root `session.started` / `idle`; provider session ID is header `id` |
| physical `type: "title"` slot | ignored for identity; bounded title text may seed the display name |
| `type: "message"` with `message.role === "user"` | first user-facing text becomes the stable root prompt label and starts a turn / `working` |
| `type: "custom"` with `customType: "tool_execution_start"` | corresponding `working` tool start using `data.toolCallId` and `data.toolName` |
| assistant message tool call | corresponding `working` tool start when no start marker already exists for that call |
| assistant message tool result | corresponding tool finish |
| assistant completion with no unanswered tools, or a terminal `stopReason` | corresponding entry `done` |
| `type: "custom"` with `customType: "session_exit"` | root inactive; interrupted when `pendingToolCalls` is present |
| child `<parent-stem>/<agentId>.jsonl` | matching child start/stop under the parent root |
| `type: "model_change"` | bounded model metadata only |
| unknown `type` or `customType` values | ignored |

Sequence numbers come from accepted record order within one binding
incarnation. Provider timestamps are used only when valid. Replayed initial
windows and repeated records cannot rewind an entry. Tool arguments, tool
output, assistant text, and reasoning are never projected.

## Agents pane and activation

The **Agents** pane is an ordinary collapsible project-sidebar section beside
Explorer and Git. It shows only roots whose exact activation terminal belongs
to the current project and nests children beneath them. Rows use stable ordering
and existing tree geometry. Missing metadata is omitted and prompts are bounded.

Activating a row activates its exact project and terminal panel, focuses the
terminal, and acknowledges that entry without changing operational state. No
approximate terminal is focused if the binding is unavailable.

## Settings and display

**Settings → AI → Agents → Agent status and sidebar** is persisted and enabled
by default. It controls journal discovery and agent UI surfaces. It never
installs, edits, trusts, or removes provider hooks or configuration.

This setting and observation pipeline are independent from the
[Terminay MCP server](./mcp-server.md). MCP may register terminal-control tools
with Codex or Claude Code, but it does not supply agent lifecycle events and it
does not register omp. MCP installation and enablement never change journal
discovery or sidebar status, and agent-status enablement never installs or
configures MCP. Observing `omp` does not require, install, or invoke MCP.

Disabling stops watchers, clears live bindings and the reduced snapshot, and
prevents discovery. Re-enabling discovers subsequently foregrounded providers
and may rescan currently live ones; it does not revive stale entries.

Bound roots render the canonical RAG glyph on terminal tabs. The header
aggregates unacknowledged meaningful entries: waiting/blocked receive priority,
done remains until acknowledged, and working may be shown for navigation.

[Showing lines 1-300 of 305. Use :301 to continue]
