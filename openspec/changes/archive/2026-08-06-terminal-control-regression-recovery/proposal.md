## Why

Terminal presentation control had regressed: initial ownership depended on
attachment race order, presentation controls appeared where there was no
conflict, the conflict bar could cover terminal content, viewports were not
fitted after ownership changed, and presentation conflicts were surfaced through
transport-error recovery UI. In the browser, a transient reconnect could unmount
the connected workspace and flash the enrollment modal.

## What Changes

- Bind initial presentation ownership to the creator, independent of attachment
  race order, and acquire an unheld presentation atomically during a
  write-authorized attach. Later attachments stay read-only and never steal from
  the current holder.
- Hide presentation controls for the holder and for holderless observers, and
  render the exact full-width conflict bar only for a competing holder, keeping
  it opaque and in layout flow so it never covers terminal content.
- Flush a fitted viewport when initial ownership or a takeover succeeds, and
  publish controller-owned canonical dimensions to every observer.
- Return one wire command envelope for acquire, takeover, and renewal while
  preserving the handler result wrapper required by revision-bearing
  presentation state.
- Treat a queued-write ownership rejection as a read-only handoff rather than a
  transport failure, and keep presentation conflicts out of transport-error
  recovery UI.
- Scope terminal journal decoding to the exact attachment before validation.
- Pin the canonical PTY emulator environment instead of inheriting the host
  `TERM`.
- Preserve the connected workspace across transient reconnect generations and
  return to enrollment only for explicit exit or unrecoverable credentials.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-workspace`: initial presentation ownership, the control bar and
  takeover presentation, viewport fitting and publication, the canonical PTY
  grid, the presentation command result envelope, rejected input after a control
  change, terminal journal routing, and the protected emulator environment.
- `remote-access`: a single connection generation per mounted workspace across
  transient reconnects.

## Impact

The server presentation-ownership protocol, the terminal panel renderer and its
control bar, terminal journal decoding, the PTY launch environment, and the
browser session reconnect and enrollment surfaces.
