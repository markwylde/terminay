# Terminal Activity Signals Specification

## Purpose

Terminay has two related, but different, activity systems:

- **Agent status** describes the lifecycle of a recognized AI agent. Provider
  hooks are authoritative for this state. See
  [agent-status-and-sidebar.md](./agent-status-and-sidebar.md).
- **Terminal activity** describes activity in any terminal, including shells,
  builds, and agents for which authoritative hooks are unavailable.

Terminal escape sequences and raw PTY output are fallback evidence. They must
never overwrite, synthesize transitions for, or otherwise compete with an
authoritative hook-backed agent entry.

## Authority and fallback order

For a terminal session, use the first available source:

1. **Provider lifecycle hooks** for a recognized Codex or Claude Code session.
   These produce canonical agent events and are the sole source of that agent's
   operational state.
2. **Structured terminal signals** when no hook-backed agent entry exists:
   `OSC 9;4` progress, `OSC 133`/`633` shell command markers, notifications,
   `BEL`, and foreground-process changes.
3. **Recent raw output** only when neither an authoritative agent entry nor a
   claimed structured-signal interpreter is available.

Authority is scoped by the exact Terminay terminal session ID. A hook-backed
agent in one terminal does not suppress fallback activity detection in another
terminal.

Once a terminal has an authoritative agent entry, spinner frames, status-bar
repaints, terminal bells, and notification escape sequences may still be
rendered normally, but they do not change the agent's canonical state. The
terminal-activity UI may omit a duplicate fallback item for that session.

## Why fallback still exists

Lifecycle hooks do not describe every useful terminal:

- ordinary shells and build tools are not agents;
- an agent's hooks may not yet be installed, may be unsupported, or may fail;
- structured shell integration can describe a command without knowing which
  application ran it;
- raw output is imperfect, but remains useful for completely uninstrumented
  terminals.

Fallback state is intentionally lower confidence. It must not be presented as
provider-authoritative agent status.

## Structured terminal signals

Notation: `OSC` starts with `ESC ]` and is terminated by `BEL` or `ST`
(`ESC \`). The parser accepts both terminators and handles sequences split
across PTY chunks.

### `OSC 9;4` progress

```text
ESC ] 9 ; 4 ; <state> [ ; <progress> ] BEL/ST
```

| State | Meaning | Fallback effect |
| --- | --- | --- |
| `0` | progress removed | working ends |
| `1` | normal progress, optionally `0`–`100` | working |
| `2` | error progress | working |
| `3` | indeterminate | working |
| `4` | paused or warning | working |

`OSC 9;4` is always parsed as progress, never as an `OSC 9` notification. An
active progress signal expires after the configured progress-signal timeout
(15 seconds by default) if it is not refreshed, and is cleared when the PTY
exits. The timeout prevents a killed process from pinning fallback activity in
the working state.

### `OSC 133` and `OSC 633` command tracking

```text
ESC ] 133 ; A ST          prompt start
ESC ] 133 ; B ST          command-line editing
ESC ] 133 ; C ST          command executing
ESC ] 133 ; D [; exit] ST command finished
```

`OSC 633` subcommands `A`, `B`, `C`, and `D` are aliases. Other `633`
subcommands are ignored. `C` without a later `D`/`A` means working; `D` ends
working and may include an exit code. A `D` immediately after `B`, without a
`C`, is an aborted command and its exit code is ignored.

Exit codes are retained for control APIs but do not add a separate failed
color to terminal tabs.

### Notifications and bell

The fallback parser recognizes:

- terminal `BEL`;
- `OSC 9;<message>`, excluding `OSC 9;4`;
- `OSC 777;notify;<title>;<body>`.

When no authoritative agent entry exists, these can set terminal attention for
an unfocused terminal. Attention remains pending until that terminal is viewed
or receives user input. For a hook-backed agent, provider events determine
`waiting`/`blocked`; a bell or OSC notification is not an authoritative agent
transition.

### Foreground process

The PTY host may report whether the foreground process differs from the spawned
shell. This is weak evidence for working and is useful for silent commands. It
also helps select a terminal-signal interpreter, but a process name alone must
not create an authoritative agent entry or infer a canonical provider state.

For an existing hook-backed Codex or Claude Code session, a recognized
provider process returning to the known shell may retire the live association
after a short confirmation window. A provider hook during that window cancels
the retirement.

## Fallback interpretation

Fallback interpretation remains provider-aware only to avoid known false
positives; it is not the canonical agent-driver layer.

- The generic interpreter prioritizes active progress, then an executing shell
  command, then foreground-process evidence, then raw output.
- The legacy Claude Code interpreter treats `OSC 9;4` as a turn boundary and
  ignores cosmetic output after progress clears.
- The legacy Codex interpreter treats a notification as a turn boundary and
  ignores spinner output after the boundary.

These profiles apply only when the session has no authoritative hook-backed
agent entry. When hooks are missing or broken, they provide best-effort tab
activity until authoritative events resume.

An interpreter that claims a session disables the raw-output timer for that
session. That prevents continuously repainting TUIs from oscillating between
working and finished.

## Display and acknowledgement

Terminal fallback activity uses the existing tab-activity language:

- amber/yellow for working or recent activity;
- green for finished, unviewed activity;
- red for fallback attention;
- no indicator after acknowledgement.

Canonical agent RAG indicators use the same broad color vocabulary but are a
different model. In particular, an agent's operational state and its
acknowledgement flag are orthogonal. Viewing an agent acknowledges it without
changing `working`, `waiting`, `blocked`, `done`, or `idle`.

For terminal fallback activity, viewing the terminal or typing into it clears
the pending terminal indicator as today.

## Parsing and data flow

Structured terminal parsing runs in Terminay Server so it is independent of
client mounting, native windows, and xterm view lifecycle:

1. The terminal signal parser parses PTY bytes with a headless xterm parser and
   emits typed protocol signals.
2. Signal interpreters reduce those signals to a `SemanticActivity` snapshot.
3. The server publishes ordered changes through the application protocol.
4. The canonical activity reducer combines fallback activity with scoped
   focus, acknowledgement, and recent-input facts.

The original data remains in the PTY stream. Parsing must not strip escape
sequences before xterm receives them. Each chunk is parsed before its raw bytes
are forwarded, so semantic activity state is ordered before client rendering
and fallback state cannot flash for one frame.

The agent lifecycle service is a separate upstream source. The server chooses
authoritative agent status for a session whenever such an entry exists; it does
not feed provider hook events through the terminal-signal interpreters.

### Client data flow

Under [server-owned workspace state](./server-owned-workspace-state.md), clients
render ordered activity events and report scoped focus/input acknowledgement;
no renderer becomes the fallback authority. Parser precedence and the original
unmodified PTY stream remain unchanged.

Transport-neutral clients maintain a bounded projection of the server snapshot.
They apply only contiguous revisions; a replay gap requests a fresh snapshot,
and reload/resync replaces the projection without replaying old transitions as
new local activity. Project-scoped projections advance the global cursor while
omitting sessions owned by other projects.

The protocol exposes this projection as `activity.snapshot` and
`activity.delta`, emits canonical `activity` events on the normal ordered event
journal, and accepts `activity.acknowledge` only with the exact immutable
`projectId` and `sessionId`. This is the client boundary used by both browser
and Desktop hosts; no `terminal:activity` IPC message is part of the server
contract.

The server reducer fences every session to its first immutable project binding.
An activity or acknowledgement request that names a different project is
ignored without consuming a revision. Events and timeout ticks carrying an
older observation time than the current session snapshot are also ignored, so
delayed PTY chunks cannot rewind state or publish a second stale transition.

## Settings

Existing tab-indicator settings continue to govern fallback terminal activity:

- **Use terminal signals for activity** enables structured-signal detection.
- **Progress signal timeout** controls `OSC 9;4` staleness.
- **Show indicator for active tabs**, **Show indicator for finished tabs**, and
  the timing settings control fallback tab indicators.

Disabling terminal-signal detection restores raw-output-based terminal activity.
It does not change the **Agent status and sidebar** setting, provider lifecycle
hooks, or canonical agent status.

The persisted **Agent status and sidebar** setting governs the agent feature as
a whole, including managed hook reconciliation and its status surfaces. It is
independent of these terminal-fallback settings.

## Error and recovery behavior

- Malformed or oversized OSC payloads are ignored without interrupting PTY
  forwarding.
- Parser/interpreter failures stay local to the terminal-activity fallback and
  do not invalidate canonical agent state.
- A stalled progress signal expires; a PTY exit clears its fallback timers.
- If authoritative hook delivery stops, the in-memory entry retains its last
  accepted state until another hook event or terminal exit. Terminay may also
  show clearly fallback-derived terminal activity, but must not silently use it
  to mutate or relabel the canonical entry.
- If authoritative events later resume for the same terminal and agent
  identity, they take precedence immediately.

## Acceptance tests

1. A hook-backed agent remains in the state set by its latest accepted lifecycle
   event while its terminal prints spinner frames, bells, and OSC progress.
2. A hook-backed agent and an ordinary shell in different terminal sessions use
   authoritative and fallback sources independently.
3. `OSC 9;4;3` followed by `OSC 9;4;0` produces fallback working then finished,
   and trailing output does not restart working after the interpreter claims
   the session.
4. `OSC 133;C` followed by `OSC 133;D;0` produces fallback working then finished
   and captures exit code `0`.
5. A bell on an unfocused, non-authoritative terminal produces sticky fallback
   attention until the terminal is viewed.
6. The same bell on a hook-backed agent does not change its canonical state.
7. Disabling terminal-signal detection uses raw-output fallback without
   disabling hook-backed status.
8. Split sequences and both `BEL`/`ST` terminators parse correctly; malformed
   sequences do not affect the PTY stream.

## Non-goals

- Inferring canonical agent states from raw text, terminal titles, spinner
  frames, process names, or escape-sequence message bodies.
- Treating an exit code as a canonical agent result without a provider event.
- Rendering progress percentages or failed-command badges.
- Installing shell-integration scripts.
- Native desktop notifications from OSC payloads.
- A public third-party terminal-signal interpreter API.
