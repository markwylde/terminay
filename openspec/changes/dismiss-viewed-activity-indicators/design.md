## Context

Green and red tab indicators mean unviewed finished work and unviewed attention. Amber means the terminal is still working. The server owns acknowledgement (`activity.acknowledge` / `agent.acknowledge`). Clients report viewing by calling those operations when a tab is selected.

Two presentation bugs leave green (and sometimes red) on a terminal the user is looking at:

1. Completing while already focused never fires `onDidActivePanelChange`, so nothing acknowledges. The snapshot fold-back in `src/App.tsx` re-acknowledges only **unclaimed** focused sessions, so structured (`explicitSeen` / claimed) and provider-backed completions stay `acknowledged: false`. The local `TerminalActivityStore` also sets `needsAcknowledgement` on working→idle even when `focused: true`. Recreated: `scripts/terminal-activity-store.test.mjs` now fails with `unviewed` instead of `viewed`.
2. `TerminalTab` renders canonical agent RAG from `agentState` and ignores `agentUnread`. A `done` agent keeps a green glyph after acknowledgement. The project count and header already omit acknowledged `done`, so they can hide while the tab glyph stays.

This is a client projection and presentation change. It does not move activity authority into the renderer, change the protocol, or teach the server which window is focused. ADR-0008 (server-bundled clients, protocol-blind hosts) and ADR-0011 (trust boundary) stay in force: the renderer still only reports viewing through the existing acknowledge commands.

## Goals / Non-Goals

**Goals:**

- Focusing a finished or attention terminal clears that terminal's indicator and drops it from the project count and header aggregate.
- Finished or attention activity that arrives on an already-focused terminal is treated as viewed.
- Working (amber) remains on the focused tab until work ends.
- Fallback activity and canonical agent RAG on tabs follow the same unviewed-vs-live rule.

**Non-Goals:**

- Per-client unread. Acknowledgement remains a server-owned session fact shared by every connected client, as it is today.
- Changing canonical agent states, journals, or the Agents pane's operational-state display.
- Changing settle-before-finished, signal parsing, or activity settings.
- Teaching `TerminalActivityReducer` about focus.

## Decisions

### Acknowledge finished and attention on the focused session, including claimed ones

Extend the snapshot fold-back so a focused session that is not `working` is acknowledged whether or not it is claimed. Working snapshots are applied as-is so amber stays. Tab selection already calls `markViewed`, which acknowledges both fallback activity and bound agents; keep that path.

Alternative considered: auto-acknowledge inside the server reducer when any client is "focused". Rejected because focus is a per-window client fact, not a session identity the server can own without a new protocol. The existing acknowledge commands are the client boundary.

Alternative considered: suppress finished indicators only in the renderer without acknowledging. Rejected because the project count and header read the same items; a local hide would desync those surfaces and revive the indicator after reload.

### Gate tab RAG for `done`, `waiting`, and `blocked` on unread; always show `working`

`TerminalTab` already receives `agentUnread`. Use it: hide `done` / `waiting` / `blocked` glyphs when acknowledged; keep `working` regardless. Fallback mapping (`unviewed` → done, `attention` → blocked, `recent` → working) already collapses to `viewed` after acknowledgement.

Alternative considered: keep showing waiting/blocked after viewing so the tab still says the agent needs input. Rejected for this change because the user-visible contract is that red is an unviewed signal, matching green. The Agents pane still shows operational `waiting` / `blocked`.

### Treat focused working→idle as viewed in the local store

When `focused: true`, do not set `needsAcknowledgement` on a working→idle transition, and do not leave finished-unviewed after suppressing attention. The local store is the fold-back when no server activity client exists; it must match the server-backed path.

## Risks / Trade-offs

- [A second connected client loses the finished indicator because the viewing client acknowledged it] → This is the existing acknowledge model; do not introduce per-client unread here.
- [A waiting agent on a focused tab no longer shows red, so a user who is looking at the terminal but not the prompt may miss an approval] → Agents pane and header (until ack) still surface waiting; working remains visible. Revisit only if that proves insufficient.
- [Existing e2e `active terminal tabs show only the finished activity status dot by default` asserts the withdrawn behaviour] → Replace it with the new focused-completion and focus-to-dismiss cases already sketched in `e2e/terminal-signals.spec.ts`.

## Migration Plan

No persisted state or protocol migration. Ship with the next client bundle. Rollback is reverting the client presentation and fold-back.

## Open Questions

None. No in-force ADR needs revisiting.
