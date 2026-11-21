## Why

After a Mac wakes, a remote Desktop window can stay on “Reconnecting…” for minutes. Retry connection leaves the same timeout on screen and can keep using the dead connection, while hovering makes the button label hard to read.

## What Changes

- Recover a remote window in place after wake, including when the WebRTC channel still reports open but carries no application traffic.
- Make Retry connection start recovery immediately during backoff or visibly join the attempt already running. Show progress and a clear outcome.
- Keep the Retry label legible on hover and keyboard focus.
- Record whether a recovery request reached Desktop main, started or joined an attempt, and received a replacement endpoint.

- Show Pair again when the remote server proves that the saved device was revoked.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts` gains a Desktop remote recovery contract for wake, Retry, and the recovery screen.
- `local-desktop-diagnostics` gains metadata-only coverage of recovery requests, outcomes, and endpoint handoff.
- `remote-access` adds a signed response for a revoked device that proves possession of its paired key.

## Impact

Desktop main, the document byte endpoint and preload bridge, and the packaged workspace recovery loop and styles. Wake and Retry work with compatible installed servers. The signed revocation response also needs updated server code and travels through the existing device signaling route.
