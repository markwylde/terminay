## Why

A terminal could stop painting while its connection stayed open, healthy, and busy: the user saw a frozen screen, kept typing, and got no error. The cause was that "where is this stream" had six independent owners, only one of which enforced contiguity — and it did so by throwing into a catch-all that discarded the fault. A discontinuity was announced out of band by a `resync_required` advisory whose `replayFrom` was computed at one moment and consumed at another, so the client could reject every subsequent frame as a replay gap and go silent.

## What Changes

- **BREAKING** The wire event `resync_required` is removed as a terminal event and replaced by an in-band `{ type: "skip", fromPosition, toPosition, reason }` marker emitted inside the delivery lane's own FIFO, exactly where the dropped bytes would have been. Desktop, browser, and server ship together; there is no compatibility shim. The unrelated projection-subscription resync `kind` and the subscription-overflow `ClientErrorCode` of the same name are untouched.
- Position authority drops from six trackers to three: the terminal service's canonical `outputPosition`/`replayFrom`, the per-attachment delivery lane's `sentPosition`/`headPosition`, and the client's passive `position` mirror.
- The delivery lane becomes the only component permitted to drop presentation bytes, and it also absorbs duplicate-delivery dedupe.
- Congestion suppression exits only when the attachment is replaced or the connection closes. The two acknowledgement-based exits — `resyncPending` in the delivery pump and `outputSuppressed` in the protocol layer — are deleted, because they required the client to acknowledge bytes the server had already refused to send.
- Watermark resume memory is deleted on both sides. A reconnect states the exact rendered position or requests a fresh presentation; no component substitutes a remembered cursor.
- Positioning faults stop being swallowed. The adapter closes the attachment instead of throwing into a discarded catch, and the client's `hydrationFailure` swallow and gap throws are removed in favour of an observable stream-failure event.
- Feeding the checkpoint authority is bounded and settled before a fresh presentation pins a checkpoint, so hydration normally begins with no gap at all; a skip established during hydration carries the distinct `hydration` reason so it cannot re-arm hydration in a loop.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminal-stream-congestion-and-recovery`: discontinuity becomes in-band and server-authoritative, suppression exits at attachment replacement, checkpoint catch-up is bounded and settled, and positioning faults are always observable.
- `remote-access`: reconnect resumes terminal subscriptions from the position the display actually rendered or a fresh presentation, never from a remembered cursor.

## Impact

- `packages/server-core/src/outboundDelivery.ts`, `connection.ts`, and `terminalService/{adapter,protocol,service,types}.ts`.
- `packages/client-core/src/{terminal,terminalPanel,types}.ts`.
- `src/components/TerminalPanel.tsx` and the `electron/serverTerminalAuthority.ts` event decode.
- The server-core and client-core suites, and `e2e/connection-reconnect-cycles.spec.ts`.
- Out of scope: connection and transport lifecycle, presentation leases, input sources, checkpoint authority internals, recording, and the WebRTC runtime.
