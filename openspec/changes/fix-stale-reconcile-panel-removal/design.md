## Context

One workspace projection is confirmed per client by `WorkspaceSnapshotStore`,
which validates every snapshot and delta and rejects any projection older than
the one it already holds. Presentation is then reconciled from that projection in
one effect in `src/App.tsx`: it adopts server terminal sessions into each
project's Dockview and calls `reconcileServerPanels`, which removes any presented
panel the canonical panel list does not contain.

Two properties of that effect meet badly:

- The pass is deferred to an animation frame and captures the snapshot it was
  scheduled with. A newer snapshot cancels the pending frame, so the frame path
  is safe.
- The pass also counts `pendingPresentations` — sessions it could not present
  this time — and schedules a 50 ms retry that re-invokes the pass **with the
  same captured snapshot**. A newer snapshot does not cancel that timer.

Sessions belonging to a project this window does not present are always
unpresentable here. The workspace projection is server-wide, so a project popped
out into a second window still contributes its sessions to this window's pass.
The retry therefore never stops arming, and every retry drives presentation from
a snapshot that is behind the store's confirmed projection.

Panel removal is command-first (`Command-first terminal panel close`): removing a
Dockview panel closes the canonical panel through
`useDockviewPanelLifecycle`'s removal hook, which ends the terminal session. A
stale pass that removes a freshly adopted panel therefore destroys a live PTY,
and the resulting close is itself a new revision that re-arms the retry window.

## Goals / Non-Goals

**Goals:**

- A reconciliation pass never acts on a projection older than the store's
  confirmed one.
- A panel present in the confirmed projection is never removed by reconciliation.
- Terminals created while another window presents a project of the same
  workspace keep their tabs and their sessions.

**Non-Goals:**

- Changing what the retry is for. Retrying remains how a pass waits for a
  workspace whose Dockview is not mounted yet.
- Changing the command-first close contract, the delta envelope, or any server
  behaviour. The defect is entirely in client presentation scheduling.
- Suppressing sessions this window does not present from the projection. The
  projection stays server-wide; only the presentation pass is scoped.

## Decisions

**Reconcile from the store, not from a captured snapshot.** The scheduled work
reads `store.snapshot` when it runs. The snapshot that triggered a pass decides
*that* a pass is due, never *what* the pass sees. This removes the whole class of
defect rather than the one path that exhibits it — a retry, a coalesced frame,
and a re-entrant publish all converge on the same current projection.

Alternative considered: capture the snapshot but compare revisions before acting,
skipping the pass when it is behind. Rejected — it makes the retry a no-op when a
newer projection exists, which silently drops the reason the retry was scheduled;
reading the current projection both fixes the staleness and does the work.

**A newer projection cancels the pending retry.** The retry timer is cleared
alongside the animation frame when a new projection arrives, so retry counts
never accumulate across revisions. With the pass reading the store this is
belt-and-braces, but it keeps "one pending pass at a time" true by construction
and stops a self-feeding retry loop from outliving its cause.

**Removal stays a projection of confirmed state.** `reconcileServerPanels` is
called only with the canonical panel list of the projection the pass just read.
This preserves the existing contract that a real close removes the canonical
panel, while denying removal to any pass that cannot prove it is current.

## Risks / Trade-offs

- [A pass that reads the store sees a projection newer than the one that
  scheduled it, so a caller cannot assume a 1:1 snapshot-to-pass mapping] →
  Reconciliation is idempotent and convergent by design: it adopts what is
  missing and removes what is absent. Converging on the newest projection is the
  intended outcome, and the coalescing frame already collapsed passes this way.
- [Cancelling the retry on a new projection could drop a genuinely pending
  presentation] → The new projection schedules its own pass, which re-counts
  pending presentations against current state and re-arms the retry if any
  remain.
- [A window that never presents some sessions keeps retrying for the retry
  budget after every revision] → Unchanged by this design and harmless once
  removal is safe; the pass is bounded, idempotent, and adopts nothing it already
  holds.

## Migration Plan

None. Client-side presentation scheduling only: no persisted state, no wire
format, and no server behaviour changes. Reverting the commit restores the prior
behaviour.

## Open Questions

None. No currently in-force ADR governs client presentation scheduling, and this
design does not suggest revisiting one.
