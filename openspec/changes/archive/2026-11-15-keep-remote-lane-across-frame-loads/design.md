## Context

`bindRemoteServerUiDocumentEndpoint` gives a remote window's document a byte
endpoint onto its server lane. When the document reloads, the old endpoint dies
with it, so the binding closes the lane, reconnects, and hands the new lane to
the new document once that document sends `server-ui-host:document-ready`.

The binding detected a reload from `webContents` `did-start-loading`. Electron
fires that event when any frame in the page starts loading, not only the main
frame. App windows render their view in an iframe, so opening, restoring or
re-rendering an app window started a "reload" that no document ever finished.
The binding then held the new lane back, waiting for a ready signal that would
not come, and the renderer timed out its session connect after 20 seconds.
Retry asked for another lane through the same binding, which was still
waiting, so it failed too.

The Local binding already filters frame loads with `isMainFrame`.

## Goals / Non-Goals

**Goals:**

- A frame load inside a remote window never costs the window its lane.
- A real document reload still gets a fresh lane, as before.
- The next lane hang is diagnosable from logs, on both ends.

**Non-Goals:**

- Changing how app windows render, or the transport, which carries
  multi-megabyte frames correctly.
- A server diagnostics level or toggle. The new records follow the existing
  always-on, metadata-only hosted diagnostics.

## Decisions

- **Check `webContents.isLoadingMainFrame()` inside the existing
  `did-start-loading` handler.** `did-start-loading` carries no frame
  argument. Moving to `did-start-navigation` with `isMainFrame` would also fire
  for same-document navigations, which keep the document and its endpoint.
  Checking the main frame inside the event already used for reloads changes
  only the case that was wrong.
- **Report replacements through an `onLaneReplaced(reason)` option.** The
  binding stays free of the diagnostics module; `main.ts` maps reasons to
  `remote.document-lane.replaced` records, info for a document reload and
  warning for anything else. A loop of replacements, or a reload with no
  following ready signal, is visible in the record stream.
- **Log only endings on the server.** `ConnectionDeliveryDiagnostic` phases
  `failure` and `closed` are logged with route (`hosted` or `local`), close
  code and queue sizes. `terminal_congestion` is a delivery signal that can
  repeat, not an ending, so it is left out. A shared line writer keeps hosted
  and connection records in one format and one sink.

## Risks / Trade-offs

- [A main-frame load that Electron does not report through
  `isLoadingMainFrame()` at `did-start-loading` time] → the E2E reload step
  covers a real reload, and the unit tests pin both cases.
- [Log volume] → one line per connection ending; connections end at human
  rate.
