## 1. Schema, bounds, and sanitizer

- [x] 1.1 Define a versioned diagnostic-event schema, stable event catalogue,
  severity/component taxonomy, launch correlation ids, value normalizer, cyclic
  object handling, 16-KiB encoded-event limit, and a common secret and path
  sanitizer, verified by hostile fixtures
- [x] 1.2 Implement the independent lifecycle channel and the per-source
  100-entry / 256-KiB rolling 10-second text budget, verified by rate-limit tests

## 2. Writer, rotation, and retention

- [x] 2.1 Implement the privileged segmented JSONL writer with user-only
  directory and file creation, one-hour/10-MiB rotation, startup/resume/periodic
  cleanup, 24-hour expiry, a 100-MiB aggregate cap, symlink-safe managed-file
  recognition, and bounded degraded behaviour for permission, disk, and
  serialization failures, verified by rotation, retention, and degraded-write
  tests

## 3. Startup ordering

- [x] 3.1 Initialize the log directory, launch marker, writer, main
  stdout/stderr observation, non-swallowing exception and rejection observation,
  Crashpad, and the unresponsive-stack feature before any renderer or embedded
  server starts, verified by startup ordering tests

## 4. Renderer and process coverage

- [x] 4.1 Register all current and future `WebContents` once and capture bounded
  console warnings and errors, preload/load/navigation failures,
  `render-process-gone`, `unresponsive`/`responsive`, stack-collection outcomes,
  and incident-time process metrics without persisting raw URLs, verified by
  fixture-driven tests
- [x] 4.2 Add the shared renderer root error boundary's bounded semantic report
  and deduplication without exposing general filesystem access or ambient
  Electron IPC, verified by deduplication tests

## 5. Embedded Local server boundary

- [x] 5.1 Route embedded Local server composition lifecycle and application
  errors through the same source limiter and sanitizer, verified by proving PTY
  data, shell output, terminal input, and standalone/remote server logs never
  enter this route

## 6. Access controls

- [x] 6.1 Add Help-menu **Reveal Diagnostics Folder** and confirmed **Clear
  Diagnostics…** actions in Desktop main, verified by exercising both while the
  Local server is unavailable and while the workspace renderer has failed

## 7. Tests and release gate

- [x] 7.1 Add focused unit and integration tests for schema stability, atomic
  complete lines, rotation and retention, resume cleanup, aggregate eviction,
  permissions, unknown-file and symlink preservation, rate limiting, redaction,
  lifecycle deduplication, clean and interrupted launch markers, and degraded
  writes
- [x] 7.2 Add Docker-isolated Electron E2E cases for packaged-style
  no-terminal startup, renderer load/preload/root failures, renderer crash and
  OOM, a GPU or child failure fixture, hang and recovery, in-process Local
  composition lifecycle, reveal and clear actions, and post-crash readability.
  The six cases in `e2e/local-desktop-diagnostics.spec.ts` run through the
  Docker-only `npm run test:e2e` suite; PR #50 and post-merge main run 6749
  passed all five shards
- [x] 7.3 Add a release-build inspection confirming crash upload is disabled, no
  diagnostics network transport dependency or endpoint is present, and no raw
  Chromium or net logging switch is enabled in the always-on profile

## 8. Acceptance

- [x] 8.1 Launch a packaged-style Desktop instance without an attached terminal,
  trigger each main/renderer/child/Local-server failure fixture, and inspect
  independently parseable JSONL evidence in the canonical platform directory
  after exit
- [x] 8.2 Force a long-running renderer task and verify an unresponsive entry
  appears promptly, stack collection resolves or times out without blocking main,
  and the later responsive entry carries one episode duration
- [x] 8.3 Flood every untrusted source with oversized, multiline, cyclic, and
  control-character input and verify responsiveness, complete JSONL lines,
  suppression summaries, truncation markers, rotation, and aggregate bounds
- [x] 8.4 Seed every prohibited content class, including raw PTY bytes and unique
  canary credentials, and assert recursively across readable logs, launch
  markers, filenames, and crash annotations that no canary persists, treating
  opaque native minidumps as potentially sensitive rather than redactable
- [x] 8.5 Seed expired, over-budget, unfamiliar, and symlinked artifacts and
  verify only recognized in-root managed artifacts are removed and an active
  segment is rotated rather than unlinked
- [x] 8.6 Trigger a fatal main exception and a native renderer crash and verify
  logging does not swallow the failure, Crashpad remains local, and the next
  launch identifies the interrupted predecessor
- [x] 8.7 Stop or break the embedded Local server composition and verify its
  lifecycle and application error are present while terminal output canaries
  remain absent
