## Context

See proposal.md for the gap. The design was chosen against Electron's own
contracts rather than a general logging library:

- [Application log path](https://www.electronjs.org/docs/latest/api/app#appsetapplogspathpath)
- [Crash reporter](https://www.electronjs.org/docs/latest/api/crash-reporter)
- [Application process events](https://www.electronjs.org/docs/latest/api/app#event-render-process-gone)
- [WebContents events](https://www.electronjs.org/docs/latest/api/web-contents#event-console-message)
- [Unresponsive JavaScript stack collection](https://www.electronjs.org/docs/latest/api/web-frame-main#framecollectjavascriptcallstack-experimental)

## Goals / Non-Goals

Goals: enough stable local evidence to classify each supported failure —
packaged crash, white screen, renderer hang, Electron child failure, embedded
Local server failure — without retaining terminal or secret content.

Non-Goals: remote transmission of any kind, visual blank-page detection or
screenshots, self-diagnosis of a main-process deadlock, and extended Chromium
tracing in the always-on profile.

## Decisions

- **Use Electron's application log path (`app.setAppLogsPath()` /
  `app.getPath('logs')`) and the local Crashpad collector** rather than
  inventing a platform path or sending data remotely.
- **One narrow privileged diagnostics service, not a generic
  renderer-to-filesystem API.** This is the renderer trust boundary: main owns a
  single queued JSONL writer and registers every `WebContents` through the
  existing global `web-contents-created` boundary.
- **Keep the renderer path observation-only where possible.** Use Electron
  `console-message`, `preload-error`, `did-fail-load`, `render-process-gone`,
  `unresponsive`, and `responsive`. Add only bounded semantic root-error
  reporting that cannot be obtained from Electron events, without exposing
  general filesystem access or ambient Electron IPC.
- **Crashpad with `uploadToServer: false`.** No crash-upload endpoint is
  installed or configured.
- **Enable `DocumentPolicyIncludeJSCallStacksInCrashReports` before readiness**
  and race `mainFrame.collectJavaScriptCallStack()` against a short timeout on
  an unresponsive renderer. The API is treated as optional and experimental: an
  unavailable outcome is recorded and normal hang logging is not weakened.
- **Record the embedded Local server composition's semantic
  starting/ready/failed/stopping/stopped lifecycle.** It is in-process and has
  no honest child stdout/stderr/exit boundary, and its ordinary application
  output is already part of bounded main output. If production later adopts the
  existing child supervisor abstraction, collection extends at that real
  boundary. The diagnostics sink is never attached to a PTY data event or a
  renderer terminal stream.
- **Prefer a small project-owned writer and sanitizer over `electron-log`.** The
  required age-based retention, strict per-source rate limits, event schema,
  renderer trust boundary, and content exclusions would still have required
  custom code, and Electron already exposes the observation hooks.
- **Do not enable raw Chromium `--enable-logging=file` or `netLog` in the
  always-on profile.** Their unstructured URL and path content, lifecycle-long
  file, and lack of age/size segmentation conflict with the privacy and
  retention contract. Native crashes remain covered by Crashpad and bounded
  Electron process events; extended Chromium tracing can be specified later as
  an explicit, temporary diagnostic mode.
- **Observe uncaught main-process failures without swallowing them.** Logging
  must not turn a fatal exception into continued execution.

## Risks / Trade-offs

Opaque native minidumps are treated as potentially sensitive rather than claimed
redactable, because their process-memory contents cannot be sanitized. Retention
and cleanup must be symlink-safe and must only remove recognized in-root managed
artifacts, so an unfamiliar or symlinked file in the diagnostics folder is
preserved and an active segment is rotated rather than unlinked.
