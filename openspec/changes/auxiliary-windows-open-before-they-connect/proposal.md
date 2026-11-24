## Why

Opening Settings from a Desktop window on a remote server shows nothing for a
second or more, then the window appears. Desktop opened the new window's own
remote connection (ADR-0048: a connection belongs to a window) before it
created the window, and kept the window hidden until the server UI painted.
The person cannot tell their click registered.

## What Changes

- A native auxiliary window (Settings and Performance Log) opens at once on
  Desktop's loading document, the logo and coloured dots, and connects from
  there. The window's page replaces the loading document when it is ready.
- Closing the window while it connects cancels the connection attempt, so it
  never holds up the next window connecting to that server.
- A connection that fails shows the existing launch recovery screen with Retry
  in that window. Retry connects again for the same window and route. A
  workspace bundle that Desktop cannot safely prepare still leaves no window
  open, with a diagnostic, as before.
- Requesting the window again while it connects focuses it and opens no second
  one. The most recent request decides which page it opens on, so asking for
  Extensions while Settings is still connecting opens Settings at Extensions.

Not in this change: sharing one connection between windows. ADR-0048 rejected
that, and this change keeps a connection per window.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: auxiliary windows appear
  immediately with a loading state while they connect.

## Impact

- **Desktop:** `electron/main.ts` (`presentCanonicalAuxiliaryRoute`,
  `createWindow`). No server, protocol, or renderer change.
- **E2E:** the child-window helpers wait past the loading document.
