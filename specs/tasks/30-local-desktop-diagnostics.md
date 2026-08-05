# Local Desktop diagnostics

## Goal

Implement the always-on, local, 24-hour Desktop diagnostic history defined by
[Local Desktop diagnostics](../features/local-desktop-diagnostics.md), so
packaged crashes, white screens, renderer hangs, Electron child failures, and
embedded Local server failures can be investigated without running Terminay
from a terminal.

Governing features:

- [Local Desktop diagnostics](../features/local-desktop-diagnostics.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Recording](../features/recording.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)

## Current gap

Desktop does not create an application diagnostic log, initialize local native
crash collection, retain renderer console/load failures, or record global
renderer/child-process hang and exit events. A packaged launch has no terminal
attached, so its stdout/stderr and the evidence preceding a white screen,
freeze, or crash are normally unavailable after the incident.

One auxiliary-window helper notices `render-process-gone` only to settle its
lifecycle promise. There is no global incident record, retention policy,
privacy sanitizer, or Help-menu action for finding diagnostics.

## Chosen design

- Use Electron's application log path (`app.setAppLogsPath()` and
  `app.getPath('logs')`) and local Crashpad collector rather than inventing a
  platform path or sending data remotely.
- Build one narrow privileged diagnostics service rather than adding a generic
  renderer-to-filesystem API. Main owns a single queued JSONL writer and
  registers every `WebContents` through the existing global
  `web-contents-created` boundary.
- Keep the renderer path observation-only where possible: use Electron
  `console-message`, `preload-error`, `did-fail-load`, `render-process-gone`,
  `unresponsive`, and `responsive` events. Add only bounded semantic root-error
  reporting that cannot be obtained from Electron events.
- Use Electron Crashpad with `uploadToServer: false` for native dumps. Do not
  install or configure a crash-upload endpoint.
- Enable Electron's
  `DocumentPolicyIncludeJSCallStacksInCrashReports` feature before readiness
  and race `mainFrame.collectJavaScriptCallStack()` against a short timeout on
  an unresponsive renderer. Treat the API as optional/experimental and record
  an unavailable outcome without weakening normal hang logging.
- Record the current embedded Local server composition's semantic
  starting/ready/failed/stopping/stopped lifecycle. It is in-process and has no
  honest child stdout/stderr/exit boundary; its ordinary application output is
  already part of bounded main output. If production later adopts the existing
  child supervisor abstraction, extend collection at that real boundary.
  Never attach the diagnostics sink to a PTY data event or renderer terminal
  stream.
- Prefer a small project-owned writer and sanitizer over `electron-log`. The
  required age-based retention, strict source rate limits, event schema,
  renderer trust boundary, and content exclusions would still require custom
  code, while Electron already exposes the required observation hooks.
- Do not turn on raw Chromium `--enable-logging=file` or `netLog` in the
  always-on profile. Their unstructured URL/path content, lifecycle-long file,
  and lack of the required age/size segmentation conflict with the privacy and
  retention contract. Native crashes remain covered by Crashpad and bounded
  Electron process events. Extended Chromium tracing can be specified later as
  an explicit, temporary diagnostic mode.
- Observe uncaught main-process failures without swallowing them. Logging must
  not convert a fatal exception into continued execution.

Relevant Electron contracts:

- [Application log path](https://www.electronjs.org/docs/latest/api/app#appsetapplogspathpath)
- [Crash reporter](https://www.electronjs.org/docs/latest/api/crash-reporter)
- [Application process events](https://www.electronjs.org/docs/latest/api/app#event-render-process-gone)
- [WebContents events](https://www.electronjs.org/docs/latest/api/web-contents#event-console-message)
- [Unresponsive JavaScript stack collection](https://www.electronjs.org/docs/latest/api/web-frame-main#framecollectjavascriptcallstack-experimental)

## Implementation slices

- [x] Define a versioned diagnostic-event schema, stable event catalogue,
  severity/component taxonomy, launch correlation ids, value normalizer,
  cyclic-object handling, 16-KiB encoded-event limit, and common secret/path
  sanitizer with hostile fixtures. Implement the independent lifecycle channel
  and the per-source 100-entry/256-KiB rolling 10-second text budget.
- [x] Implement the privileged segmented JSONL writer, user-only directory/file
  creation, one-hour/10-MiB rotation, startup/resume/periodic cleanup, 24-hour
  expiry, 100-MiB aggregate cap, symlink-safe managed-file recognition, and
  bounded degraded behaviour for permission/disk/serialization failures.
- [x] Initialize the log directory, launch marker, writer, main stdout/stderr
  observation, non-swallowing exception/rejection observation, Crashpad, and
  unresponsive-stack feature before any renderer or embedded server starts.
- [x] Register all current and future `WebContents` once and capture bounded
  console warnings/errors, preload/load/navigation failures,
  `render-process-gone`, `unresponsive`/`responsive`, stack-collection outcomes,
  and incident-time process metrics without persisting raw URLs.
- [x] Add the shared renderer root error boundary's bounded semantic report and
  deduplication without exposing general filesystem or ambient Electron IPC.
- [x] Route embedded Local server composition lifecycle and application errors
  through the same source limiter and sanitizer; prove PTY data, shell output,
  terminal input, and standalone/remote server logs never enter this route.
- [x] Add Help-menu **Reveal Diagnostics Folder** and confirmed **Clear
  Diagnostics…** actions in Desktop main so they remain usable independently
  of workspace renderer and server health.
- [x] Add focused unit/integration tests for schema stability, atomic complete
  lines, rotation/retention, resume cleanup, aggregate eviction, permissions,
  unknown-file and symlink preservation, rate limiting, redaction, lifecycle
  deduplication, clean/interrupted launch markers, and degraded writes.
- [ ] Add Docker-isolated Electron E2E cases for packaged-style no-terminal
  startup, renderer load/preload/root failures, renderer crash/OOM, GPU or child
  failure fixture, hang/recovery, in-process Local composition lifecycle,
  reveal/clear actions, and post-crash readability. Run them only through
  `npm run test:e2e`.
- [x] Add a release-build inspection that confirms crash upload is disabled,
  no diagnostics/network transport dependency or endpoint is present, and no
  raw Chromium/net logging switch is enabled in the always-on profile.

## Acceptance checks

- Launch a packaged-style Desktop instance without an attached terminal,
  trigger each specified main/renderer/child/Local-server failure fixture, and
  inspect independently parseable JSONL evidence in the canonical platform
  directory after exit.
- Force a long-running renderer task and verify an unresponsive entry appears
  promptly, stack collection resolves or times out without blocking main, and
  the later responsive entry carries one episode duration.
- Flood every untrusted source with oversized, multiline, cyclic, and
  control-character input and verify responsiveness, complete JSONL lines,
  suppression summaries, truncation markers, rotation, and aggregate bounds.
- Seed every prohibited content class—including raw PTY bytes and unique
  canary credentials—and assert recursively across readable logs, launch
  markers, filenames, and crash annotations that no canary persists. Treat
  opaque native minidumps as potentially sensitive rather than claiming their
  process-memory contents are redactable.
- Seed expired, over-budget, unfamiliar, and symlinked artifacts; verify only
  recognized in-root managed artifacts are removed and an active segment is
  rotated rather than unlinked.
- Trigger a fatal main exception and native renderer crash and verify logging
  does not swallow the failure, Crashpad remains local, and the next launch
  identifies the interrupted predecessor.
- Stop or break the embedded Local server composition and verify its
  lifecycle/application error is present while existing terminal output
  canaries remain absent.
- Exercise reveal and clear while the Local server is unavailable and while
  the workspace renderer has failed.

## Definition of done

The feature acceptance outcomes and checks above pass, focused non-Electron
tests cover bounds and privacy failures, Electron cases pass through
`npm run test:e2e`, packaged builds keep crash upload and raw Chromium/network
logging disabled, and the retained artifacts contain enough stable evidence to
classify each supported failure without retaining terminal or secret content.
