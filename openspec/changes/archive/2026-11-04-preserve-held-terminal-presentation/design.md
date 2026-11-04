## Context

The Docker regression in `e2e/terminals-survive-restart.spec.ts` proves a repeatable failure with the same live process: mouse mode 1003 reports enabled before restart and disabled afterwards; a key still redraws the screen, but a wheel gesture exposes retained terminal rows. A short-history control passes. Native blur/focus, terminal switching, and renderer reload pass in the separate mouse test. The actual macOS unlock/tab-switch trigger is not established.

`SessionHolder` retains only a 1 MiB raw ring. `SessionHolderClient.attach` replays that ring; `factory.adopt` and `reattachHeldSessions` seed `TerminalService.adoptSession` at its first retained byte. The new server creates a default emulator at that position. Once initial setup has been evicted, default modes are inevitable. Increasing the ring postpones the failure.

The existing `TerminalPresentationCheckpointAuthority` already provides bounded headless interpretation, explicit mouse tracking/encoding serialization, parser-safe checkpoint C with ordered resize/output tail to H, and no bridge from terminal-query replies to a PTY. Its default bounds are 256 sessions, 1,000 scrollback rows, 64 KiB output chunks, 1 MiB queued bytes, 2 MiB state, 1 MiB tail, and 4,096 tail events.

The ADR inventory is reviewed through 0094, including supersession links. ADR-0086 is the current holder commitment and carries forward ADR-0035's no-terminal-parsing clause through 0077/0083. ADRs 0011, 0028, 0044, 0047, 0048, 0051, 0071, 0079, and 0088 constrain trust, scheduling, cost, client ownership, process recovery, runtime distribution, and disk state. Superseded records are historical context.

## Goals / Non-Goals

**Goals:** Restore actual terminal presentation and input modes after holder-backed restart, including mode changes and output while disconnected; retain real raw offsets, identity, geometry, process lifetime, input authorization, bounded memory, and frozen holder generations. Make the long-history regression pass with the short-history control unchanged.

**Non-Goals:** Change Codex or Claude; force mouse modes; add renderer heuristics or a running-session disk journal; fix unrelated wake/lease issues; reconstruct state discarded by existing holders; claim the original unlock trigger is proven.

## Decisions

### 1. Presentation lives for the lifetime of the held PTY

Reuse `TerminalPresentationCheckpointAuthority` inside the holder, beginning at spawn and following output and canonical resizes even while detached. This revisits ADR-0086's inherited no-parsing clause; a new ADR supersedes only that restriction and restates all remaining commitments by reference. Headless xterm gets no `onData`/`onBinary` PTY bridge, extensions, agent-specific state, or renderer access.

Parsing is proportional to incoming bytes, queued separately from the live byte shuttle. Reuse existing size/session limits and parser-safe snapshots. Queue admission/backpressure must be event-driven and bounded; server-requested pause and parser backlog are independent reasons to pause, and disconnect must not strand a PTY paused. A presentation failure must leave existing live output and process lifetime intact and make recovery explicitly unavailable.

Boundary: authenticated server internals become responsible for interpreting untrusted PTY output in a longer-lived process. No new public principal or authority is introduced. The cost is an additional bounded emulator per held session. Reusing the existing implementation avoids a second escape-sequence parser.

Rejected alternatives: a larger ring cannot guarantee mode recovery; forcing SGR/capture changes ordinary shells; retaining only enable sequences mishandles disable/reset/buffer changes and fragmented controls; server-owned opaque checkpoints become stale while detached; durable running-output logs violate the storage policy.

### 2. Versioned, bounded binary recovery state

Negotiate holder protocol version 3 for presentation recovery. Preserve version 1/2 wire behaviour, handshake rules, and frozen generation compatibility. Version 3 carries a bounded binary recovery value in ordered chunks, scoped to the exact requested session, with contiguous offsets, declared total size, checkpoint format, parser-safe position C, head H, checkpoint/final geometry, state length, and bounded tail descriptors. Payloads contain state and raw tail bytes, not base64 output in JSON. Reject malformed, oversized, truncated, unexpected-session, or non-contiguous transfers.

At recovery, pause streaming for that session, pin a checkpoint/tail, retain concurrent raw bytes until the response can be completed, send recovery and retained raw output in order, then continue live output beyond the established head. Use an immutable cut and explicit catch-up so output produced while awaiting the parser cannot fall between replay and live subscription. Bind asynchronous work to its original connection; a disconnect must not send its result to a later server. A bounded refusal is preferable to presenting a default emulator as a successful restoration.

Boundary: local holder/server wire only. Authentication precedes presentation. No changes to renderer-facing application operations or remote authority. Existing holders are read through their original raw attach path; their lost presentation cannot be repaired retroactively.

### 3. Seed server presentation separately from raw PTY history

Carry typed recovery metadata through `HolderSessionStream`/client attach, `SessionHolderPtyFactory.adopt`, and `reattachHeldSessions` into terminal adoption. Add an initialization path to the checkpoint authority that installs restoration state at C in its original grid, consumes ordered tail events through H, and then accepts later output. This path must validate identity, contiguous raw positions, lengths, format, and geometry before installation.

Keep the raw ring as raw output at its original offsets; restoration bytes never advance those offsets or enter activity, recordings, shell integration, or the PTY. During adoption, retained bytes already represented by the seed are cached/replayed as raw bytes without being interpreted a second time by the canonical emulator. Subsequent output is parsed exactly once. Gate fresh presentation on seed initialization and raw replay completion, and retain existing client checkpoint authorization and lease checks.

Boundary: trusted PTY adoption into server presentation. The recovered process remains authoritative for live output, and the server remains authoritative for client access and input.

### 4. Verification follows the actual failure

Keep the original failing test's same-PID, wheel counter, key redraw, native-scrollback, and DECRQM evidence. Require both long and short controls to pass through `npm run test:e2e`. Add focused tests for mode disable while detached, more than a ring of detached output, split UTF-8/control strings and a resize in the unsafe tail, exact raw byte positions/no synthetic output, old-version negotiation, malformed/oversized transfers, disconnect during preparation, and bounded cleanup/query-reply isolation.

## Risks / Trade-offs

- [Additional holder memory/CPU] → Reuse explicit existing bounds; no history scan per output event; test operation scaling and run the focused repaint-cost suite.
- [Independent server and holder parser queues diverge] → Preserve identical byte order and resize events, transfer parser-safe state plus exact tail, and verify fresh-server state rather than only visible output.
- [Reconnect races during async snapshot] → Capture the connection and session identity, stop/reconcile streaming at a bounded cut, and test concurrent output and disconnect.
- [Old generations lack state] → Preserve their frozen raw protocol; document that new guarantees begin with presentation-capable generations. Never infer missing state from an agent name.
- [Resource exhaustion] → Keep process and live stream alive, expose precise presentation failure, release pins and incomplete transfers, and bound per-session pending data.

## Migration Plan

The Windows copied holder runtime must include `@xterm/headless` and `@xterm/addon-serialize`; packaging unpacks these runtime dependencies, and the copy test must resolve them after deleting the original installation. No workspace or disk migration is needed. A new build starts presentation-capable holder generations for new sessions and continues speaking older generations' negotiated protocols. Rollback uses those generations' raw attach contract; it cannot retain the new presentation guarantee. Running output remains in memory, and ended-unattached tails retain their existing disk policy.

## Open Questions

ADR-0086's inherited prohibition on holder terminal parsing must be superseded by the ADR artifact. No additional owner decision is needed beyond the requested correction; actual macOS unlock causality remains unknown and is not an acceptance claim.
