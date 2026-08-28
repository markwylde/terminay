# Agent Status and Agents Sidebar Specification

## Summary

Terminay composes installed coding-agent extension providers with project
environments and reduces their canonical lifecycle events into provider-neutral
agent entries. A native source is authoritative
only after Terminay binds it to the exact server-owned PTY through that
provider's documented terminal identity evidence.

The same canonical model feeds terminal-tab status, a project-scoped **Agents**
pane with roots and in-process subagents, and the header activity dropdown.
Raw terminal signals remain a lower-confidence fallback when a supported
journal cannot be discovered or parsed. See
[terminal-activity-signals.md](./terminal-activity-signals.md).

## Ownership and privacy

Terminal/project authorization, environment routing, canonical validation,
ordering, snapshots, acknowledgement, and terminal/project mapping live in
Terminay Server. Provider-specific discovery, process binding, incremental
reading, version selection, and native-record normalization live in separately
hosted extensions using only the public Extension API. Connected clients
subscribe to the same ordered reduced snapshot. Clients never read provider
journals or create competing agent state.

Provider journals and stores are private privileged inputs. Their raw records,
prompts, responses, instructions, reasoning, tool arguments, and tool output
never cross the server boundary and are never logged by the integration.

Foreground-process and journal discovery are public project-environment
capabilities. Agent extensions are ordinary trusted Node.js programs: on This
server they combine the host-issued terminal context (including the PTY shell
PID) with Node process and filesystem APIs, typically through the public
observation helpers. Those helpers run in the extension child; they are not a
sandbox and must not round-trip local `lsof`/`ps` snapshots through host IPC.
The child inherits a bounded host environment (`PATH`, `HOME`, locale) so the
same `ps`/`lsof` binaries the Electron process used on main still resolve;
installer-style sterile `NODE_OPTIONS` is not applied to agent observation.
Process-name matching is only a prompt: `codex`/`codex-tui` bind Codex, while
an unmatched `node`/`bun` wrapper tries every capable provider until one
proves a writer-held journal, the same way main scanned every journal when
the foreground name did not name a provider. Observation also inspects the
PTY shell PID itself so an `exec`'d CLI still has its open files examined.
SSH and other non-local environments cannot use the server host's process tree
or home directory. They use the environment-routed observation broker when the
environment advertises that capability; otherwise observation is unavailable.

## Product outcomes

- Running a CLI supplied by an enabled agent extension normally in an
  interactive Terminay terminal is discovered without editing provider
  configuration or installing global integrations.
- Agent state remains associated with the exact terminal the user can activate.
- Provider file formats and versions stay out of client components and stores.
- Newer compatible provider versions reuse the latest known mapping.
- Unsupported, missing, malformed, or ephemeral journals degrade safely to
  terminal activity.

If a running provider is matched and its terminal admission subsequently
fails, Terminay releases that provider claim and replays the same foreground
change through terminal activity. This is a fallback, not a successful agent
observation: the privileged host records one bounded `agent-admission-failed`
diagnostic containing only the provider id, opaque terminal identity, and a
coarse failure class. It never records raw journals, paths, prompts, or an
extension error message. The diagnostic makes a failed admission distinguishable
from a terminal that simply has no agent, without allowing an extension failure
to interrupt the terminal.

## Canonical model

Provider ids are namespaced extension contributions rather than a closed core
union. Terminay bundles enabled-by-default Codex, Claude Code, Cursor Agent,
and omp providers. A third-party provider appears through the same validated
manifest, hosted runtime, canonical event, Settings, and disablement contracts.
Persisted unknown or disabled provider ids remain bounded metadata and never
cause provider code to load in a client.

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
foreground process. Cursor's bundled worker may likewise expose `node`, and a
shebang-run `omp` on macOS may expose `bun`.
Every transition away from the shell therefore starts a new bounded
journal-discovery window even when the foreground name is not a recognized
provider. This lets a resumed session launched long after terminal startup
bind its reopened journal without treating the wrapper itself as an agent.
Foreground sampling may miss a brief return to the shell between an exited
session and `codex resume`. A repeated match for the same provider keeps an
active root observer intact, but starts a fresh binding incarnation when that
terminal's canonical root has already exited.
The journal is still admitted only after the provider's documented identity
evidence is proven. An `omp` binary that sets its process title still matches
`omp` directly; a `bun` wrapper is admitted only after the OMP terminal
breadcrumb for the exact PTY identifies a validated OMP root JSONL.

Codex's TUI typically opens its writable rollout after the first foreground
edge. The fast not-bound window therefore often finishes while the journal
does not yet exist. Topology polling must re-admit on the first sample after
that window, not only when a later signature changes; otherwise a live Codex
session sits in the terminal with an empty Agents pane.

Once an extension proves a terminal-scoped binding, Server Core materializes
the root session immediately. The first provider-native `session.started`
record refines that root as metadata, so a slow watcher or optional enrichment
cannot hide a proven active session from the Agents pane.

Live Agents projection is scoped to one running Terminay process, not to a
durable user-data `serverId`. Each process mints an ephemeral
`processInstanceId` at boot and stamps it on every snapshot it emits. A
client connected to that process renders only that snapshot. Two processes
that share project names, session ids, or `~/.codex` files still cannot
populate each other's Agents pane.

Observation stays bound only while the journal writer remains a descendant of
a PTY shell this process spawned. A later `codex resume` in another Terminay
process may write the same journal path; the first process must drop the
observer as soon as that writer leaves its PTY tree. Sharing a user-data
directory is an Electron profile concern, not Agents authority: live pane
state is the processInstanceId on the snapshot, not occupancy of
`Terminay Development`.

CWD, filename timestamps, terminal title, active tab, and “closest match” logic
must not independently establish an authoritative binding. Claude Code uses its
exact descendant process CWD to establish the native project journal directory
and post-process-start root writes to select the active session. OMP uses its
own terminal-scoped breadcrumb, whose terminal ID is derived from the PTY TTY
that runs OMP and whose target is validated under OMP's allowed session root.
A host that cannot establish provider proof uses terminal fallback instead.

## Agent extension observation contract

An agent extension observation runtime:

1. obtains provider-specific terminal-to-journal identity evidence beneath the
   effective provider home;
2. proves that evidence belongs to the registered PTY shell process or its
   terminal TTY;
3. reads a bounded initial window and then only appended bytes;
4. buffers an incomplete final JSONL line until it is completed;
5. detects truncation, atomic replacement, provider session switch, writer exit,
   and process-incarnation change;
6. keeps raw records inside its isolated extension host and emits only validated
   canonical lifecycle events;
7. stops all file/process observation when the terminal, integration, or server stops.

Discovery is retried briefly after terminal startup and whenever the shell
loses foreground because either transition can arrive before the journal is
opened. A blank or unknown process name is not a leave-shell edge and does not
start discovery. A provider that reports `not-bound`, or whose observation
throws before a journal is proven, is retried at most ten times at a 100 ms
debounce while that exact foreground incarnation remains current. After that
fast window, topology polling keeps discovery armed until the incarnation is
bound or returns to the shell. An empty process snapshot is ordinary transient
evidence, not a reason to give up on the pane. Expensive
open-file/process inspection is used for initial binding, not for every
appended record. Local open-file snapshots prefer journal paths
(`.jsonl` and `/sessions/`) and stay bounded for the provider, not because
they cross host IPC. Optional enrichment after a proven bind (session-name
index, child directory listing, `CODEX_HOME`) must not fail admission.
Symlinks, non-regular files, paths outside the canonical
sessions root, oversized records, invalid JSON, and unbounded growth are
handled defensively.

## Public versioned driver contract

The public driver abstraction is identified by `(provider, mappingVersion)`, for
example `(codex, 0.1)`. A driver recognizes session metadata, maps a strict
allowlist of native records to canonical lifecycle events, and reads only
bounded lifecycle/display metadata. It never focuses UI, asserts project or
terminal authorization, reads outside broker-issued capabilities, mutates the
canonical store directly, imports a private Terminay module, or exposes raw
records.

Mapping versions describe Terminay parsers. Provider CLI versions are
normalized to major/minor. The registry chooses the greatest mapping version
less than or equal to the running provider version. A provider newer than all
known mappings uses the newest mapping optimistically; one older than all
mappings uses the oldest. Unknown records are ignored so additive changes are
compatible.

Each extension package owns its mappings, bounded fixtures, documentation, and
contract tests. A
compatibility script runs a candidate provider-version fixture against the
mapping the registry would select. Passing means no new mapping is required;
semantic failure requires a new mapping and fixtures without changing earlier
mappings.

## Codex extension mapping

The `terminay-agent-codex` package owns every Codex executable name, home-root
rule, process/journal binding rule, mapping version, fixture, and compatibility
test described here.

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
| `event_msg/item_completed` carrying a `CollabAgentToolCall` or `SubAgentActivity` | fan out its bounded child identity and state into child lifecycle events |
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

Codex stores an explicit user-edited session title separately from a rollout in
the effective `CODEX_HOME/session_index.jsonl` file (or
`~/.codex/session_index.jsonl` when `CODEX_HOME` is unset). Its matching `id`
and bounded non-empty `thread_name` are display metadata for that same root
session. The extension follows that terminal-scoped index while the rollout is
bound: an initial title, every subsequent rename, and a title recovered after
the index is atomically replaced or truncated updates the existing root entry
in place. A title change never creates another root, replays lifecycle events,
or changes working, waiting, blocked, done, or child state. If there is no
explicit title, the first eligible user message remains the root label.

Codex subagents have separate rollout journals under the same effective
sessions root. A child journal declares its native parent in
`session_meta.source.subagent.thread_spawn.parent_thread_id` and repeats the
bounded parent/session and display metadata needed for safe projection. The
extension lists and follows only a bounded terminal-scoped sessions directory
through the public observation broker, so children created after the root is
bound are admitted live as well. It includes a journal as a child source only
when that native parent id equals the already bound root provider session id;
native child ids are de-duplicated across the initial listing and later
directory snapshots. Timestamp,
path proximity, `agent_path`, and display text never establish a child-parent
relationship. A discovered child starts, updates, completes, and exits beneath
the existing root without changing that root's lifecycle or creating a second
root binding.

While Codex remains in the foreground, Terminay revalidates the rollout held
open by that exact process tree. Opening a different eligible root rollout
switches the tail, retires the previous root, and replays the fresh or resumed
session.

## Claude Code extension mapping

The `terminay-agent-claude-code` package owns the Claude Code mapping and uses
the same zero-injection boundary. It binds an exact
`claude --resume <uuid>` descendant to that UUID's root JSONL below the project
directory in `~/.claude/projects`. For a new `claude` process it admits only one
root journal created for the exact process working directory after that process
started. An open writable root journal remains an eligible fallback;
`subagents/` journals and unrelated history are not eligible roots. It uses
explicit `ai-title` records for the root label, assistant model metadata,
bounded tool lifecycle, and `Agent` tool use/result pairs for named child
lifecycle. Meta/local-command user records, tool-result content, assistant
text, and reasoning are never projected.

## Cursor Agent extension mapping

The `terminay-agent-cursor` package owns Cursor executable recognition,
process-bound chat-store discovery, transcript mapping, metadata refresh,
fixtures, compatibility tests, and the privacy boundary described here.

Cursor Agent CLI chats live below `~/.cursor/chats`, while their JSONL
transcripts live below `~/.cursor/projects`. Terminay does not read Cursor's
SQLite conversation payloads. It uses only an exact writable `store.db` held
by the registered PTY process tree, the bounded adjacent `meta.json` cwd, and
the shared session UUID in the chat-store and transcript paths to bind the
corresponding transcript. The canonical cwd is encoded using Cursor's project
directory convention. Paths outside either canonical Cursor root, malformed
UUIDs, symlinks escaping those roots, and timestamp/nearest-file matches are
not eligible.

The first supported mapping is `(cursor, 0.1)`. Cursor transcripts do not carry
a session header, so the process-bound chat-store path supplies the stable
provider session ID. A bounded non-empty `meta.json` title is the root label and
is refreshed while the transcript remains bound so Cursor renames update live.
Terminay reads only the bounded `lastUsedModel` field from the exact
process-bound `store.db` metadata row in read-only mode; it never reads SQLite
conversation blobs. This model metadata is also refreshed while bound.
When no title exists, a user record starts a turn and its bounded
`<user_query>` content, excluding Cursor's timestamp wrapper, becomes the root
label. Assistant records keep the turn working without
projecting assistant text, reasoning, tool arguments, or tool output. A
`type: "turn_ended"` record maps its status to a successful, failed, or
cancelled `done` result. Current transcripts do not persist an unresolved
permission or elicitation record, so they do not authoritatively produce
`waiting` or `blocked`; generic terminal activity remains the fallback while
such a prompt is on screen.

Cursor currently persists `Task` tool calls without stable task IDs or matching
completion records. Terminay therefore does not project those calls as child
agents: an inferred child that cannot be authoritatively completed would leave
stale or misattributed sidebar entries.

## omp extension mapping

The `terminay-agent-omp` package owns every omp/Bun executable rule, data-root
rule, terminal breadcrumb, mapping, title-slot parser, and fixture described
here.

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

The **Agents** pane is the Agents sidebar group's collapsible pane. It shows
only roots whose exact activation terminal belongs to the current project and
nests children beneath them. Rows use stable ordering and existing tree
geometry. Missing metadata is omitted and prompts are bounded.

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
