# ADR-0028: Never poll; a poll is a last resort that needs the owner's explicit approval

Status: accepted, supersedes ADR-0022
Date: 2026-09-24
Supersedes: ADR-0022

## Context

ADR-0022 said polling is not permitted for any state a watch can observe. It
was right, and it still was not enough. Nine days after it was accepted, a user
with ten projects open found Git running constantly, still running after every
project was closed. The 10 s Git status poll that ADR-0022 had named a defect
was still in place. Because nothing ever unbound a closed project, it kept
polling projects the user was no longer using. A timer that exists by default
fails by default. It keeps doing work when nobody is watching, and it outlives
whatever it was created for.

ADR-0022 left two openings that let polls survive:

- **"A watch can observe it" was the author's call.** A timer author who
  decides a watch is impractical has, under ADR-0022, made a legitimate
  choice. The same review question comes back: "is this interval right?"
  instead of "why is there an interval?"
- **Residual polls were recorded, not decided.** PTY foreground sampling was
  written down as "still a poll" and left in place. Recording a poll is not
  the same as someone accountable agreeing to it.

The repository owner has asked that polling be treated as a last resort that
only they can approve. That is a stronger rule than ADR-0022's, so this record
supersedes ADR-0022 and restates the parts of it that remain in force.

## Decision

1. **Do not poll.** Code must not re-check a state on a timer to find out
   whether it has changed. That covers files, directories, processes, sockets,
   peers, remote services, the DOM, and application state. Learn about change
   from the thing that changes: a filesystem watch, an OS or runtime event, a
   subscription, a protocol message, a callback, or a `MutationObserver`.
2. **A poll is a last resort, and only the repository owner can approve it.**
   A poll may be introduced or kept only when no event source exists or can
   reasonably be built. The repository owner (Mark Wylde) must explicitly
   approve that specific poll. Approval is recorded in the change that
   introduces it: its `design.md` names the poll, its interval, why no event
   source works, and the owner's approval with its date. The code site carries
   a comment citing this ADR and that change. An agent, a reviewer, or a CI
   check cannot grant approval. An agent that believes it needs a poll stops
   and asks.
3. **What is not a poll.** The following timers are allowed without
   approval:
   - a one-shot timeout or deadline
   - the ramp that damps work after an observed event (decision 5)
   - presentation driven purely by the passage of time that reads no external
     state, such as a clock or a relative "2 min ago" label
   - a retry after a failure, bounded by attempt count or deadline

   Heartbeats, wait-until-ready loops, and "just in case" refreshes are polls.
4. **Unobservable means on demand, not sampled.** If a watch fails or cannot
   be established, the fallback is to do the work when a caller asks for it,
   not to add a timer. Degrading to "fresh when asked" is acceptable. Silently
   degrading to sampling is not.
5. **Carried forward from ADR-0022.** A watch event schedules work behind the
   shared ramp: run promptly after a quiet period, then 1 s, 2 s, 3 s, 5 s,
   10 s, and 20 s while change continues, holding at 20 s. Events inside an
   interval collapse into one run at its end. The ramp is a floor between runs,
   not a delay after the last event. There is one implementation, used
   everywhere. Agent discovery is driven by watching its files, and reading a
   process table to learn a filename is prohibited. A feature that is switched
   off schedules nothing.
6. **Whatever starts observing also stops it.** Every watch, subscription,
   and approved poll is owned by a lifecycle, such as a project, session,
   window, or client, and is torn down when that lifecycle ends. Anything
   that can outlive its owner is a defect, whatever it costs.

## Consequences

- Review asks "what event are you waiting for?" and, if the answer is "none",
  "where is the owner's approval?". A pull request that adds a periodic timer
  without a citation to an approved change is blocked.
- Every poll that exists today is unapproved until the owner decides on it.
  None is approved by this record. See the open items.
- Some sources become fresh on request rather than live (decision 4). That is
  an accepted trade.
- Tests that relied on a poll to observe change instead inject the event
  source, such as a fake watcher, and assert that no work runs while idle.

## Open items

Each existing timer below must be replaced with an event source, removed, or
explicitly approved by the owner in its own change:

- Git worktree status poll, 10 s (`packages/server-core/src/gitService/service.ts`).
  Removed by change `git-status-watch-and-project-release`.
- PTY foreground-process sampling (`packages/server-core/src/terminalService/nodePty.ts`).
  The candidate replacement is shell integration.
- Dockview window-listener reconcile, 500 ms
  (`src/workspace/useTerminalDockviewWindowController.ts`). The candidate
  replacement is a `MutationObserver` or Dockview events.
- File viewer refresh-interval fallback (`src/components/file-viewer/FilePanel.tsx`).
- Settings window status poll (`src/components/SettingsWindow.tsx`).
- Project tab drag cursor poll (`electron/main.ts`, `projectDragPollTimer`).
- Desktop update check, hourly (`electron/main.ts`, `UPDATE_CHECK_INTERVAL_MS`).
- Diagnostics sampling at 1 s and 5 s, and cleanup at 15 min
  (`electron/diagnostics/`).
- Terminal presentation checkpoint, 5 s
  (`packages/server-core/src/terminalService/presentationCheckpoint.ts`).
- Web session heartbeat, 10 s (`src/web/sessionConnectAttempt.ts`).
- Remote exposure cleanup (`apps/terminay-server/src/remote/serverExposure.ts`)
  and the data-channel readiness wait
  (`apps/terminay-server/src/remote/nodeDataChannelPeer.ts`).
- CLI health and pairing wait loops (`apps/terminay-cli/src/`).
- Add a lint or CI check that flags new `setInterval` and self-rescheduling
  `setTimeout` sites that lack an ADR-0028 approval citation.
