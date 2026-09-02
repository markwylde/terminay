## Why

A packaged Desktop launch has no terminal attached, so its stdout and stderr —
and the evidence preceding a white screen, freeze, or crash — were unavailable
after the incident. Desktop created no application diagnostic log, did not
initialize local native crash collection, retained no renderer console or load
failures, and recorded no renderer or child-process hang and exit events. One
auxiliary-window helper noticed `render-process-gone` only to settle its own
lifecycle promise; there was no incident record, retention policy, privacy
sanitizer, or Help-menu action for finding diagnostics.

## What Changes

- Add an always-on, local, 24-hour Desktop diagnostic history written as
  segmented JSONL into Electron's application log path, with a versioned event
  schema, stable event catalogue, severity/component taxonomy, launch
  correlation ids, and a common secret and path sanitizer.
- Add one narrow privileged diagnostics service in Desktop main with a single
  queued writer, per-source rate limits, a 16-KiB encoded-event limit,
  one-hour/10-MiB rotation, 24-hour expiry, a 100-MiB aggregate cap, and
  symlink-safe managed-file recognition.
- Register every `WebContents` through the global `web-contents-created`
  boundary and capture bounded console warnings and errors, preload, load, and
  navigation failures, `render-process-gone`, `unresponsive`/`responsive`,
  JavaScript call-stack collection outcomes, and incident-time process metrics.
- Enable Electron Crashpad with `uploadToServer: false` for local native dumps.
- Record the embedded Local server composition's semantic lifecycle and
  application errors through the same limiter and sanitizer, never from a PTY
  data event or renderer terminal stream.
- Add Help-menu **Reveal Diagnostics Folder** and confirmed **Clear
  Diagnostics…** actions in Desktop main so they work when the workspace
  renderer or Local server is unhealthy.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `local-desktop-diagnostics`: the always-on bounded local history, its
  ownership boundary, artifact set, record format, crash and hang evidence,
  rotation, retention, cleanup, access controls, content exclusions, and release
  gate.

## Impact

Desktop main process startup ordering, the application menu, a new privileged
diagnostics writer and sanitizer, the shared renderer root error boundary, the
embedded Local server composition lifecycle, `e2e/local-desktop-diagnostics.spec.ts`,
and the release-build inspection script.
