## Context

See proposal.md. The gap was a modelling one: the presentation-oriented
`working` status is deliberately suppressible — by provider authority, command
completion signals, user acknowledgement, output timers, and activity-indicator
settings — because it drives an indicator. Close protection needs the opposite
property: a fact that nothing may suppress.

## Goals / Non-Goals

Goals:
- Never terminate a running foreground process without asking.
- Never interrupt the close of an idle shell.
- Keep the guard correct across terminals, projects, and native windows.

Non-Goals:
- Changing termination or graceful shutdown semantics once a close is confirmed.
- Guarding moves: a tab or project moving between views is not a closure.

## Decisions

- **`foregroundBusy` is a separate snapshot field, not a reading of `working`.**
  It is true only while the PTY host reports that a process other than the
  spawned shell owns the foreground process group. Because it is separate, no
  display setting or acknowledgement can suppress it, and clients are required
  to use it rather than infer busyness from terminal output.
- **The guard is scoped by session id, then aggregated upward.** A terminal
  close consults only its own session. A project close consults every session it
  contains. Aggregation counts sessions, so one session cannot be double-counted
  into an inflated warning.
- **Desktop receives a bounded busy-session set per window.** Electron owns the
  native window close event and cannot ask the renderer synchronously, so each
  window publishes its bounded busy-session set to the privileged main process.
  This crosses the renderer/privileged boundary deliberately: it carries session
  identity and a boolean only, never terminal content.
- **Confirmation is scoped to the target window.** Confirming closure of a
  non-final project window closes only that window; sibling windows stay alive
  and usable. Application quit is reserved for the final project window or an
  explicit Quit command, so a busy torn-off window cannot take the application
  down with it.
- **Destructive labels are context-specific and the safe choice is the
  default.** Dialogs use **Close Terminal**, **Close Project**, or **Quit
  Terminay**, and both the default action and the cancel action are **Keep
  Running**, so a reflexive Enter or Escape preserves work.
- **Moves are not closures.** Moving a tab or project between views neither
  displays a warning nor terminates a PTY.

## Risks / Trade-offs

- A false negative silently kills work, so the signal deliberately fails towards
  reporting busy: helper children of a non-shell foreground process do not make
  a session look idle.
- Extra confirmation dialogs are a friction cost, bounded by only warning when a
  non-shell foreground process is actually known to be running.
- Native-window behaviour cannot be covered by focused tests alone; Docker
  isolated Electron end-to-end cases were added for the terminal and torn-off
  project journeys.
