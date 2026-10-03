## Context

Each project workspace renders one error banner from a single `errorText` state
in `src/App.tsx`. Every failure a project reports — Explorer, Git, Agents,
Settings, terminal creation, AI tab metadata, shell profiles — sets that state,
and it is cleared only by a later successful operation or by the transport
retirement in `terminal-stream-congestion-and-recovery`. The banner itself is a
plain `div` with no control.

Feature failures also record a `featureFailureRef` entry, which the success and
reconnect paths consult to decide whether the visible notice is theirs to clear.

## Goals / Non-Goals

**Goals:**

- Let the user dismiss the banner for any failure, from one control.

**Non-Goals:**

- Auto-expiring notices, stacking several notices, or a notification history.
- The settings, macros, and recordings windows' own inline error rows.

## Decisions

**One control on the shared banner, not per-source handling.** Every failure
already flows through one state, so a single dismiss handler covers all of them
and any source added later.

**Dismissal clears the feature-failure record too.** Leaving
`featureFailureRef` set after the text is gone would let a later success or
reconnect compare against a notice that is no longer shown. The handler resets
both.

**Dismissal is presentation-local.** It changes renderer state for that project
view only; nothing is sent to the server and no boundary is crossed. A failure
reported after dismissal shows the banner again, since it is a new statement.

## Risks / Trade-offs

- A failure that recurs on every refresh reappears after dismissal → accepted;
  suppressing repeats would hide a condition that is still true.
