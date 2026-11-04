## Context

The user reports intermittent loss of clicks and scrolling after returning to a long Codex session, with keyboard input unaffected. The installed xterm versions reproduce a narrower, deterministic failure: enable `?1000` tracking and `?1006` SGR encoding, write 300 history lines, serialize, and restore into a fresh terminal. Before restoration, clicks/releases/wheel reports arrive on `onData` as SGR sequences. After restoration, tracking remains enabled but reports arrive on `onBinary` as default-encoding sequences; keyboard characters still arrive on `onData`. This reproduces the failure mechanism, not the exact tab-switch trigger or a Codex-versus-Claude distinction.

Observed implementation:

- `presentationCheckpoint.ts` uses SerializeAddon for initial and later checkpoints. The installed addon's `_serializeModes` restores tracking but omits mouse encoding.
- `TerminalPanel.tsx` subscribes to `onData` only. Recovery clears the display with `terminal.clear()`, which does not establish a complete mouse-mode baseline.
- `ServerTerminalInputQueue` accepts strings, measures UTF-8 byte lengths, and owns bounded ordering, presentation roles, and replacement attachment handling. The client attachment already accepts `Uint8Array | string`.
- Both `terminalService/nodePty.ts` and `sessionHolder/holder.ts` decode input bytes as UTF-8 before calling node-pty. Simply wiring `onBinary` into the string path would corrupt high coordinate bytes. Installed node-pty's write contract accepts strings or buffers; Windows behavior must be validated against its platform implementation.
- Existing checkpoint tests, input queue tests, and `e2e/terminal-presentation-recovery.spec.ts` supply the relevant test seams. The investigation scripts are local evidence with absolute machine paths, not portable regression tests.

The ADR inventory runs through 0088. Supersession links were reviewed; pertinent current constraints include ADR-0011 (trust boundaries), ADR-0028 (no polling), ADR-0044 (output-event cost), ADR-0047 (window/server bundle ownership), ADR-0048 (window-scoped attachments), ADR-0051 (agent independence), and ADR-0086 (holder boundary). Superseded ADRs 0008, 0018, and 0035 are historical context, not independent constraints.

## Goals / Non-Goals

**Goals:** Preserve mouse tracking and encoding through checkpoint attachment/recovery; deliver mouse reports to the right PTY with exact bytes, bounded ordering, and existing ownership checks; verify both SGR and default-encoding reports, ordinary scrollback, and long-session tab return.

**Non-Goals:** Change Codex or Claude configuration; disable mouse tracking on tab switches; introduce agent-specific heuristics, global event interception, new input transport operations, unlimited queues, or changes to presentation ownership. This change does not promise to repair a live terminal whose original encoding state was already lost from an old checkpoint.

## Decisions

### 1. Complete mouse state at the checkpoint boundary

Add a small version-specific xterm compatibility helper around checkpoint serialization. Read the headless emulator's canonical tracking/encoding state and append explicit restoration sequences for supported mouse modes, including off/default state. Capture mode state at the same parser-safe position and geometry as serialized screen data. Reuse this serializer for every checkpoint construction path. Keep the existing checkpoint format version: the payload remains a bounded escape-sequence restoration stream.

The ordered checkpoint tail remains authoritative for later mode changes. Explicitly reset obsolete tracking/encoding state before restoring the captured state, so recovery into a reused display cannot retain modes absent from the new checkpoint. Do not reset unrelated live state independently of the checkpoint queue.

Boundary: server-owned PTY interpretation to disposable client presentation. The checkpoint authority owns the mode snapshot; the client must not infer it from the agent title, DOM, or recent raw output.

Alternatives: a dependency upgrade would be suitable only with proven coverage of the exact installed versions and every required mode; none is assumed here. Forcing SGR in every terminal would change the protocol selected by applications. Capturing only enable sequences fails when recovery reuses an emulator with obsolete modes. A broad terminal reset adds unrelated restoration risks and is unnecessary for this targeted correction.

### 2. Feed binary reports through the existing input queue

Subscribe to `onBinary` beside `onData`, convert each binary string code unit to its corresponding byte, and enqueue an owned `Uint8Array`. Extend ordinary queue items to accept text or bytes and measure text as UTF-8 and binary by byte length. Keep paste chunking and mobile keyboard modifiers on the text path. Dispose both subscriptions with the panel.

Keep one queue for keyboard and mouse input; reuse its bounds, role checks, binding fence, generation handling, and uncertain-delivery semantics. Never send binary reports directly to an attachment or add a separate mouse queue.

Boundary: untrusted shared renderer to server-authorized terminal input. Neither a mouse callback nor a binary payload confers a presentation lease or changes project/session scope. Read-only input remains refused.

Alternatives: subscribing to `onBinary` and forwarding its string through TextEncoder corrupts non-ASCII bytes. Fixing serialization alone leaves valid default-encoding programs without input. A second direct mouse transport bypasses ordering and authority safeguards.

### 3. Preserve bytes through the privileged PTY boundary

Audit the existing binary input route through client-core, server terminal input, holder framing, and both node-pty adapters. Remove lossy UTF-8 decoding where the platform supports byte writes and pass a copied Buffer to the concrete PTY write API. Keep Node/Buffer usage server-side and retain the renderer's Uint8Array contract. Text input remains UTF-8 encoded exactly once at the existing client boundary.

Verify the Windows node-pty/ConPTY write path before selecting its implementation: ConPTY's Unicode input model must not silently reinterpret a binary string as UTF-8. The proposed contract requires exact bytes; do not silently substitute an event-equivalent translation or claim raw-byte parity without evidence. If that cannot be supported by the concrete platform API, revise the design/spec explicitly before implementing a platform exception. Any need for a new wire format or broader platform policy is also a design revision, not an implicit fallback.

Boundary: authorized server input through authenticated holder IPC to native PTY ownership. Preserve holder credentials, scope validation, queue limits, and lifecycle behavior. No renderer Node privileges or new native API is introduced.

Alternatives: Latin-1 decoding followed by UTF-8 string writes still changes bytes; keeping the current TextDecoder is demonstrably lossy for default mouse coordinates. A global terminal encoding change would also alter output and ordinary keyboard behavior.

### 4. Verify observable input with synthetic programs

Add checkpoint round-trip tests for SGR, default encoding, supported tracking variants, disabled state restored over an enabled display, and ordered-tail changes. Add queue and adapter tests with bytes at and above 0x80, Unicode keyboard input, queue bounds, read-only refusal, disposal, and replacement attachment behavior.

In Docker Electron E2E tests, run a synthetic raw-input program that enables modes, writes long history, and renders received reports as hex or decoded events. Assert clicks, releases, wheel reports, and keyboard markers before and after a forced checkpoint-backed attachment/recovery. Separately switch project/terminal tabs away and back without assuming that this alone remounts the panel; assert session identity and input continue. After disabling tracking, assert drag selection and actual viewport scrolling. Retain the existing non-finite mouse-coordinate guard.

Boundary: validation observes PTY input through test-owned terminal programs. It requires no agent credentials, private transcripts, or changes to agent executables. Run Electron tests only through `npm run test:e2e`.

## Risks / Trade-offs

- [xterm internal mode access changes] → Isolate it in one compatibility helper and test against the pinned browser/headless/serialize package combination. Fail visibly in tests if a required state field is unavailable.
- [SGR pixel encoding or mode precedence differs from ordinary SGR] → Enumerate supported encodings from the installed emulator and cover their enable/disable ordering, rather than guessing from public tracking mode alone.
- [Input bytes corrupted by one remaining text conversion] → Assert high-byte payloads at both the queue/adapter boundary and a real PTY receiver; keep Unicode typing and paste regression coverage.
- [Windows PTY input has different encoding behavior] → Validate its concrete write path and include a platform-specific verification task; record any limit instead of declaring success from a Unix-only test.
- [A tab switch without restoration has another cause] → Keep it as a separate acceptance journey; report failure and trace the actual event/attachment state instead of treating the checkpoint proof as complete user-scenario evidence.
- [Existing mounted sessions retain broken mouse state] → Fresh correct checkpoints/re-attachment restore only state the authority still knows. No guessed mouse-mode injection into a running application.

## Migration Plan

Ship matching server-core and shared renderer changes through the ordinary build. No workspace-state migration, checkpoint envelope change, or host protocol extension is planned. Newly generated checkpoints contain complete mouse state. Roll back by reverting the change and shipping the previous bundle/server; the previous mouse defect can recur. Do not terminate existing PTYs as part of deployment or rollback.

## Open Questions

- Which mount, reconnect, or congestion event triggered restoration in the originally reported live Codex session? The deterministic regression can be fixed independently; the tab-return E2E journey must still pass.
- What byte or event-equivalent path does the pinned Windows node-pty implementation support for default mouse encoding? Resolve this with a focused adapter experiment before claiming cross-platform coverage.
- No in-force ADR requires revision: these are tactical repairs within existing checkpoint, input, and PTY boundaries.
