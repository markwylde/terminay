# Agent Status and Agents Sidebar Specification

## Summary

Terminay shows recognized Codex and Claude Code sessions as provider-neutral
agent entries. Provider lifecycle hooks are authoritative: drivers normalize
native hook payloads into one canonical state model, keyed to the exact
Terminay terminal session in which the agent runs.

The same model feeds:

- a compact status indicator on the owning terminal tab;
- a project-scoped **Agents** pane with root agents and in-process subagents;
- the header notification/activity dropdown.

Raw terminal signals remain available only as terminal-activity fallback. They
must not override an authoritative agent entry. See
[TERMINAL_ACTIVITY_SIGNALS.md](./TERMINAL_ACTIVITY_SIGNALS.md).

## Goals

- Make it obvious which agents are working, need the user, or have finished.
- Keep provider-specific event formats out of renderer components and stores.
- Associate every root agent and child with the exact terminal the user can
  activate.
- Preserve user-owned provider hook configuration during install and uninstall.
- Survive renderer reloads and reject stale or out-of-order lifecycle events.
- Degrade safely when hooks are unavailable without pretending fallback guesses
  are authoritative.

## Canonical model

### Providers

The initial canonical provider IDs are:

- `codex`
- `claude-code`

Display labels may be `Codex` and `Claude Code`. Native event names and config
formats are driver details, not additional providers or UI states.

### Operational states and RAG treatment

| State | Meaning | Indicator |
| --- | --- | --- |
| `working` | The agent is processing a prompt, running a tool, or otherwise making progress. | Yellow/amber, with restrained motion. |
| `waiting` | The agent has explicitly requested permission, an answer, or other user input. | Red. |
| `blocked` | The agent cannot make progress because of an explicit blocking lifecycle event. | Red, with an accessible label distinct from waiting. |
| `done` | The provider reports that the current turn or agent run has stopped. | Green. |
| `idle` | The session exists but has no active work or pending result to emphasize. | Neutral or hidden on compact surfaces. |

`working`, `waiting`, `blocked`, `done`, and `idle` are the only canonical
operational states in v1. The UI must not add inferred states such as
“thinking”, “planning”, “tooling”, “offline”, or “success” without a later
model change.

The indicator conveys state through text/ARIA labels as well as color.
Animation honors reduced-motion preferences.

### Acknowledgement is orthogonal

Acknowledgement/unread is not an operational state. Each entry independently
tracks whether its latest meaningful transition still needs acknowledgement.

- `markAcknowledged` changes acknowledgement metadata only.
- Acknowledging a `working` agent leaves it `working`.
- Acknowledging a `waiting` or `blocked` agent leaves its red state intact; it
  only removes the unread/count treatment.
- Acknowledging `done` leaves it `done`.
- A later meaningful lifecycle transition can make an entry unacknowledged
  again.

This distinction prevents “viewing” an agent from lying about what the provider
said it is doing.

Unread treatment is rendered separately through counts, row accents, or other
notification chrome. A compact surface may request a red needs-attention
variant, but that presentation does not redefine the stored operational state.

### Root entries and subagents

A root entry represents the provider process associated with a Terminay PTY.
An in-process subagent is a child entry in that root's roster, not a new root.

At minimum, entries carry stable identity, provider, canonical state,
acknowledgement, state timestamps, last-event timestamp, and activation
terminal session ID. Provider/model/prompt metadata is optional and displayed
only when the driver supplies it.

Child rules:

- Native subagent-start/stop events or a child `agent_id` update the child
  roster.
- A child transition does not replace the root agent's operational state.
- A child keeps an explicit `parentAgentId`/root relationship.
- A child without its own PTY uses the root's
  `activationTerminalSessionId`.
- Stable child identity comes from the provider's child/agent ID, scoped to the
  owning root and activation terminal; display text is never an identity key.
- A stop event updates or retires the matching child only. It must not mark an
  unrelated child or the root as done.

## Exact terminal and project identity

When Terminay creates a local PTY, it injects:

- `TERMINAY_SESSION_ID`: the opaque Terminay terminal session UUID;
- `TERMINAY_AGENT_HOOK_ENDPOINT`: the loopback lifecycle receiver URL;
- `TERMINAY_AGENT_HOOK_TOKEN`: a receiver authentication secret.

Managed provider hooks inherit these values from the agent process and include
them when delivering events. The main process resolves the event by the exact
`TERMINAY_SESSION_ID`; terminal title, CWD, provider process name, active tab,
and “closest match” logic are forbidden for identity.

The terminal session maps to its Dockview panel and owning Terminay project in
renderer state. A root entry's `activationTerminalSessionId` is that session
ID. An in-process child inherits it unless the provider proves the child owns a
different Terminay PTY.

Unknown, exited, or cross-window session IDs are rejected or ignored safely.
The runtime must not attach such events to whichever terminal happens to be
focused.

## Event ordering and reducer behavior

Drivers emit normalized lifecycle events with an event timestamp, monotonically
increasing sequence, and stable agent identity. The store is deterministic:

- accept newer events for an entry;
- reject out-of-order events that would rewind it;
- keep `stateStartedAt` unchanged when an event repeats the same state;
- update `stateStartedAt` when the canonical state changes;
- update acknowledgement independently;
- keep root and child reductions isolated;
- publish immutable snapshots and subscription updates.

Terminal session closure or an explicit agent-exit event ends live association
and prevents later stale hook events from resurrecting the entry. A newly
started provider session in the same terminal must have a distinct stable
agent/session identity.

## Driver contract

Provider drivers are the only modules that understand native hook payloads and
configuration. A driver/registry exposes the focused capabilities needed by the
runtime:

1. identify its canonical provider;
2. validate and normalize a native payload into zero or one canonical agent
   lifecycle event;
3. report managed-hook installation status;
4. install the Terminay-owned hook entries idempotently;
5. uninstall only the Terminay-owned entries.

Normalization may return no event for unsupported or malformed native input.
Drivers do not focus UI, infer projects, mutate the agent-status store directly,
or parse terminal output.

The main-process receiver:

- listens only on loopback;
- accepts only the intended HTTP method/path and JSON content;
- validates the bearer/token secret and exact terminal identity;
- caps request bodies and rejects malformed JSON;
- sends validated payloads through the driver registry;
- stamps/accepts ordering metadata and publishes ordered snapshots over IPC.

Secrets and full native payloads are not logged or exposed to the renderer.

## Provider mappings

Drivers map native lifecycle meaning, not message text:

| Native meaning or hook | Canonical result |
| --- | --- |
| Session starts | root `idle` until the first work event |
| Prompt/turn starts or resumes | root `working` |
| Tool activity | corresponding root or child `working` |
| `PermissionRequest` | corresponding entry `waiting` |
| `request_user_input` / `AskUserQuestion` | corresponding entry `waiting` |
| Explicit normalized blocked lifecycle event | corresponding entry `blocked` |
| `Stop` / turn complete | corresponding entry `done` |
| `StopFailure` | corresponding entry `done`, with available error metadata; it is not a new color/state |
| Session stop | corresponding root `idle` and inactive |
| Agent/terminal exit | corresponding entry `done` and inactive |
| Subagent start/child `agent_id` | create or update child; do not replace root state |
| Subagent stop | update/finish the matching child only |

### Codex

The Codex driver consumes supported native hook payloads and associates them
with the inherited Terminay session environment. Prompt/session/tool events
produce `working`; explicit user-input requests produce `waiting`; stop
boundaries produce `done`; child agent IDs maintain the subagent roster.

Terminal spinner output and OSC/BEL notifications are not canonical Codex
events. If managed hooks are unavailable, the existing Codex terminal-signal
profile may provide clearly fallback-derived terminal activity.

### Claude Code

The Claude Code driver consumes supported hook events from the managed entries
in `~/.claude/settings.json`. Session/prompt/tool activity produces `working`;
`PermissionRequest` and explicit question/input tools produce `waiting`;
stop boundaries produce `done`; subagent start/stop updates children. The
initial driver does not infer `blocked` from `StopFailure`; it records a `done`
result with an error outcome.

Claude's `OSC 9;4` progress and notifications remain fallback terminal signals,
not canonical lifecycle authority.

Drivers must ignore native event names they do not explicitly support rather
than guessing a state from arbitrary payload text.

## Hook installation, preservation, and uninstall

Initial managed configuration targets:

- Codex: `~/.codex/hooks.json`;
- Claude Code: `~/.claude/settings.json`.

Codex hook state is index- and hash-trusted in `~/.codex/config.toml`.
Terminay appends new Codex groups so existing user hook indexes do not move,
keeps an existing Terminay group at its current index, reconciles the exact
managed hashes, and removes only its matching trust blocks on uninstall.

Filesystem and home-directory paths are injectable in tests.

Installation is reconciliation, not replacement:

- parse the existing config safely;
- preserve every user-owned hook, matcher, setting, and unknown field;
- add only uniquely identifiable Terminay-owned entries;
- avoid duplicates on repeated install;
- place the Terminay hook before user hooks when the provider format preserves
  hook ordering;
- use an argv/command representation that is safe for spaces and shell
  metacharacters;
- write through a same-directory temporary file and atomic rename where
  practical;
- never persist the per-terminal receiver token in global config.

The managed command reads the endpoint, token, and session ID from the agent's
inherited environment, posts a bounded JSON request to loopback, and exits
quickly. Hook delivery failure must not block or change the provider's own hook
chain.

Uninstall:

- removes only entries that can be positively identified as Terminay-owned;
- preserves user hooks before and after those entries;
- preserves unrelated config formatting/fields as far as the selected parser
  permits;
- is idempotent when no Terminay entry exists;
- refuses destructive cleanup when ownership is ambiguous.

Invalid config produces an actionable error and remains untouched. Permission,
parse, and write failures fail closed; Terminay must not truncate or silently
recreate an unreadable user config.

## Agents pane

The **Agents** pane is an ordinary collapsible section in the project sidebar,
alongside Explorer and Git. It does not introduce a second sidebar tab or
replace the other project tools. The pane uses presentation-only components
over the canonical snapshot.

### Filtering and order

- Show only roots whose `activationTerminalSessionId` belongs to the current
  project.
- Show each matching root's children directly beneath it.
- Do not leak agents from other project tabs into the active project's pane.
- Use deterministic ordering. Active/needs-user entries may be emphasized, but
  entries must not jump unpredictably on every metadata update.
- Show a concise empty state when the project has no recognized agents.

Each row may show provider, model, short prompt/description, state, and
acknowledgement. Missing optional metadata is omitted rather than replaced by
invented values.

### Click to focus

Activating a root row:

1. activates the owning project if necessary;
2. resolves the exact `activationTerminalSessionId` to its panel;
3. activates that Dockview panel;
4. focuses the terminal;
5. marks the selected entry acknowledged without changing its state.

Activating an in-process child follows the same flow using the child's
`activationTerminalSessionId`, which normally focuses the root terminal. If
the exact session/panel no longer exists, keep the app stable, show/retain a
non-destructive unavailable state as implemented, and do not focus an
approximate terminal.

### Settings toggle

**Settings → AI → Agents → Agent status and sidebar** is a persisted boolean and is
enabled by default.

Enabling it reconciles the Terminay-managed Codex and Claude Code hook entries
and enables the terminal-tab, project-sidebar panel, and header status surfaces. Disabling it
removes only Terminay-managed hook entries and hides/disables those agent
surfaces. It does not remove user-owned hooks or unrelated provider settings.

The existing Explorer/Git layout settings and the terminal-signal fallback
settings remain independent.

## Tab indicator and notification dropdown

Terminal tabs with a recognized root agent render the canonical RAG status
glyph. Canonical agent status is not encoded by repurposing the ordinary
terminal-activity underline. Non-agent terminals keep existing fallback
activity indicators.

The header notification/activity control aggregates unacknowledged meaningful
agent entries alongside any existing terminal-activity items:

- counts are derived from acknowledgement plus canonical state, not from color
  alone;
- waiting/blocked items receive needs-user priority;
- done items remain available until acknowledged;
- working may be shown for navigation without being treated as a needs-user
  notification;
- selecting an item uses the same exact click-to-focus behavior as the Agents
  pane and acknowledges only that entry;
- entries include enough provider/project/terminal context to distinguish
  similarly named agents;
- acknowledged states may remain visible in the project pane while leaving the
  unread dropdown/count.

No native OS notification is required by this feature.

## Persistence and freshness

The main process owns the canonical in-memory snapshot and republishes it after
a renderer reload. This preserves lifecycle state and acknowledgement while the
app process remains alive.

V1 does not persist agent entries across a full app restart and does not
provide historical agent runs. The persisted setting survives restart, but the
snapshot begins empty. Within one app run:

- the latest accepted entry remains current until a newer ordered event or
  terminal lifecycle event arrives;
- repeated same-state events preserve `stateStartedAt`;
- a terminal exit emits a final inactive `done` transition for active roots;
- the receiver rejects events for terminal sessions that are no longer active;
- there is no timer that silently rewrites `working`, `waiting`, or `blocked`
  merely because hooks become quiet.

## Error and fallback behavior

- Hook receiver errors are isolated from PTY input/output and agent execution.
- Invalid authentication, path, method, body size, JSON, provider, event, or
  terminal identity is rejected without changing state.
- Driver normalization errors do not partially update a snapshot.
- Hook-install status/error is reportable without exposing secrets.
- Missing hooks may leave no canonical agent entry. Terminal signals can still
  produce ordinary fallback activity for that terminal.
- A hook-backed entry never accepts a state transition inferred from raw
  output, process names, terminal titles, OSC payload text, or `BEL`.
- When an exact activation terminal disappears, clicking an entry never falls
  through to a title/CWD match.
- Subagent payload errors cannot overwrite root identity or state.

## Acceptance tests

### Store and ordering

1. The canonical store accepts `working → waiting → working → done`, preserves
   `stateStartedAt` for same-state updates, and changes it on state changes.
2. An older event cannot rewind a newer entry.
3. `markAcknowledged` changes acknowledgement only for the target entry.
4. A child event changes only the matching child; root and sibling states are
   preserved.
5. Terminal/agent exit prevents stale events from resurrecting an ended entry.

### Runtime and security

6. Every local PTY receives a unique exact session ID plus endpoint/token
   environment.
7. The loopback receiver accepts a valid bounded authenticated request and
   rejects wrong method/path/token, malformed JSON, oversized bodies, and
   unknown terminal IDs without mutation.
8. Snapshot IPC survives renderer reload and never exposes the receiver token.
9. Session cleanup removes or ends only entries for the closed terminal.

### Drivers and hooks

10. Codex and Claude fixture payloads normalize to the canonical mappings above.
11. Permission/question events become `waiting`; stop events become `done`;
    Claude Code `StopFailure` is `done` with an error outcome; an explicit canonical
    `wait.started` with state `blocked` becomes `blocked`.
12. Subagent start/stop and child IDs maintain stable lineage without replacing
    the root state.
13. Install twice creates one Terminay-owned hook set and preserves all user
    hooks/settings.
14. Uninstall removes only Terminay-owned entries; malformed/ambiguous configs
    remain byte-for-byte untouched.
15. Managed hook commands handle paths with spaces, use inherited identity and
    a bounded timeout, and do not persist secrets.

### UI

16. The RAG glyph and accessible label match every canonical state; reduced
    motion disables working animation.
17. The Agents pane shows only the active project's roots and their children in
    deterministic order.
18. Clicking a root or in-process child activates its exact terminal and
    acknowledges it without changing operational state.
19. A missing terminal does not activate a similarly titled terminal.
20. Disabling the feature removes only Terminay-managed hooks, hides agent
    surfaces, and preserves unrelated user/provider configuration; re-enabling
    reconciles a single managed hook set.
21. The header dropdown prioritizes unacknowledged waiting/blocked entries,
    navigates by exact session ID, and removes an entry from unread counts after
    acknowledgement.
22. A hook-backed agent ignores spinner output, OSC progress, and bell state
    changes; an uninstrumented terminal still uses fallback activity.

## Non-goals

- Inferring canonical states from terminal output.
- A user-defined or third-party driver/plugin API.
- Remote-web Agents pane parity.
- Native desktop notifications.
- Persisted transcripts or complete historical event logs.
- Starting, stopping, or replying to an agent from the Agents pane.
- Inventing separate colors for every provider-native hook.
