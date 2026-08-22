# Agent Status and Agents Sidebar Specification

## Summary

Terminay observes supported coding-agent session journals and reduces their
native records into provider-neutral agent entries. A journal is authoritative
only after Terminay binds its live writer process to the exact server-owned PTY
that launched it.

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

- Running `codex` normally in an interactive Terminay terminal is discovered
  without editing provider configuration or installing global integrations.
- Agent state remains associated with the exact terminal the user can activate.
- Provider file formats and versions stay out of client components and stores.
- Newer compatible provider versions reuse the latest known mapping.
- Unsupported, missing, malformed, or ephemeral journals degrade safely to
  terminal activity.

## Canonical model

The initial canonical provider is `codex`. The driver registry permits future
providers such as `claude-code`, but Terminay does not claim Claude Code journal
support until a driver and process-bound source are implemented and tested.

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
privileged host discovers journal files held open by the provider process or
its descendants. A journal becomes authoritative only when its writer belongs
to the exact PTY process tree. Environments without this capability use the
documented terminal-activity fallback.

The binding is immutable for one live provider-process incarnation. A resumed
provider session may reopen the same journal in another terminal; the new
writer creates a new binding incarnation and activation terminal without
allowing stale events from the previous incarnation to mutate it.

The Codex launcher may expose a generic wrapper such as `node` as the PTY
foreground process. Every transition away from the shell therefore starts a
new bounded journal-discovery window even when the foreground name is not a
recognized provider. This lets a resumed session launched long after terminal
startup bind its reopened journal without treating the wrapper itself as an
agent. The journal is still admitted only after a writable handle is proven
beneath the exact PTY process tree.

CWD, filename timestamps, terminal title, active tab, and “closest match” logic
must not establish an authoritative binding. A host that cannot prove the
writer relationship uses terminal fallback instead.

## Journal source contract

A provider journal source:

1. discovers an open native journal beneath the effective provider home;
2. proves that its writer descends from the registered PTY shell process;
3. reads a bounded initial window and then only appended bytes;
4. buffers an incomplete final JSONL line until it is completed;
5. detects truncation, replacement, writer exit, and process-incarnation change;
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
with Codex or Claude Code, but it does not supply agent lifecycle events. MCP
installation and enablement never change journal discovery or sidebar status,
and agent-status enablement never installs or configures MCP.

Disabling stops watchers, clears live bindings and the reduced snapshot, and
prevents discovery. Re-enabling discovers subsequently foregrounded providers
and may rescan currently live ones; it does not revive stale entries.

Bound roots render the canonical RAG glyph on terminal tabs. The header
aggregates unacknowledged meaningful entries: waiting/blocked receive priority,
done remains until acknowledged, and working may be shown for navigation.

## Persistence, errors, and fallback

The server republishes its in-memory reduced snapshot after client reload.
Entries do not survive a server restart as Terminay history. A live provider can
be rebound and a bounded journal tail replayed to reconstruct current state.

The transport-neutral agent projection is the renderer's sole revision
authority. Ordinary live snapshots are monotonic within one server authority
incarnation. An explicit reconnect or replay-gap resync is an authority
boundary: its complete snapshot replaces the prior projection even when its
revision is lower because the server restarted its revision sequence. Host
adapters forward that resync boundary unchanged, and presentation components
render the accepted projection without applying a second revision fence.

- Unsupported, missing, inaccessible, ephemeral, unbound, oversized, or
  malformed journals leave the terminal on terminal-activity fallback.
- A bound journal is authoritative; terminal output, spinner frames, BEL, and
  OSC notifications cannot overwrite it.
- Observation failure retains the last state until process/terminal lifecycle
  retires it; no quiet timer invents a transition.
- Raw journal bytes never enter snapshots, telemetry, logs, renderer APIs, or
  remote transports. A bounded user-message preview may populate the existing
  agent label; model output, command arguments, and tool results are discarded.

## Acceptance tests

1. Starting ordinary interactive Codex creates no provider config files and
   requires no global hook installation.
2. `task_started` then `task_complete` map to `working` then `done`.
3. A journal is accepted only when its writer belongs to the exact Terminay PTY tree.
4. Concurrent Codex terminals with the same CWD never exchange events.
5. Approval and user-input records produce `waiting`; later progress resumes working.
6. Subagent records update only the matching child.
7. `(codex, 0.1)` fixtures pass; a compatible `0.2` fixture passes the
   compatibility script without adding a mapping.
8. A newer unknown version selects the latest known mapping and ignores unknown records.
9. Partial lines, truncation, replacement, oversized records, malformed JSON,
   and inaccessible files fail safely without exposing contents.
10. Disabling clears observation and state without touching `.codex`.
11. Client reload/project switching preserve scope and create no duplicate watchers.
12. A reconnect/resync after a server revision restart replaces stale `done`
    state, resumes a working agent, and admits newly discovered concurrent agents.
13. Electron end-to-end coverage runs only through `npm run test:e2e`.
14. A current Codex completed `UserMessage` event supplies the bounded root
    label; raw response items and non-text content are ignored.
15. Current Codex collaboration fields create a named child beneath its exact
    parent, while interaction, resume, interruption, and close update only that child.
16. The first authoritative Codex user-message event becomes the stable root
    label. Injected raw context, model-context `<turn_aborted>` markers, and
    later user-message events cannot rename it.

## Non-goals

- Installing or reconciling provider hooks.
- Modifying provider hook, config, or trust files.
- Redirecting or mirroring the user's full `CODEX_HOME`.
- Treating CWD, timestamps, titles, or active-tab state as ownership proof.
- Exposing or indexing conversation contents beyond the bounded agent label.
- Replacing the interactive provider TUI with an app-server frontend.
- Claiming Claude Code support before its source and driver are implemented.
