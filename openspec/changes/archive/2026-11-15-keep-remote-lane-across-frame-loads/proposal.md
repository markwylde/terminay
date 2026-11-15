## Why

A Desktop window on a remote server could not reconnect once the server held
an agent's app window. Every attempt showed "Terminal stream stalled.
Reconnecting…" and then "Session connect timed out after 20000ms", and Retry
failed the same way.

An app window's view is a frame inside the workspace document. Desktop watched
the window for `did-start-loading` to notice the document reloading, and that
event fires for a frame's load too. Desktop took the frame load for a reload:
it closed the window's lane, reconnected, and then waited for a new document to
say it was ready. The document had not changed, so it never said so, and the
session never received the server's hello. The Local route already ignored
frame loads; the remote route did not.

Nothing recorded why a lane was replaced or why the server ended a
connection, so the hang took a reproduction to find.

## What Changes

- Desktop replaces a remote window's lane for a document reload only when the
  window's main frame is loading. A frame loading inside the document keeps the
  lane.
- Desktop records each replacement of a remote window's lane with its reason:
  document reload, transport ended, transport failed, or reconnect retry.
- The standalone server records, for every protocol connection it fails or
  that closes, the route, the close class and the queued bytes and frames, to
  stderr and its log sink.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: "Native window reload preserves binding"
  says what a reload is, and that a frame loading inside the document is not one.
- `local-desktop-diagnostics`: the always-on lifecycle coverage records remote
  lane replacements and their reason.
- `server-runtime-and-protocol`: standalone diagnostics record why each
  protocol connection ended.

## Impact

- Code: `electron/serverUiDocumentEndpoint.ts`, `electron/main.ts`,
  `electron/diagnostics/core.ts`, `apps/terminay-server/src/remote/hostedDiagnosticLog.ts`,
  `apps/terminay-server/src/localUiServer.ts`, `apps/terminay-server/src/cli.ts`.
- Tests: `scripts/remote-endpoint-reconnect-retry.test.mjs`,
  `apps/terminay-server/test/hosted-stream-diagnostics.test.mjs`, and a new
  E2E spec `e2e/desktop-remote-large-app-windows.spec.ts`.
- No protocol, UI, settings or dependency changes. The fix ships in Desktop;
  the server change adds logging only.
