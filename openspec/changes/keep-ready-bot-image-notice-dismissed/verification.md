# Review: keep-ready-bot-image-notice-dismissed

Date: 2026-11-28

Scope: the uncommitted diff against `origin/main`, tracing the
implementation of this change.

| Dimension | Result |
| --- | --- |
| Completeness | 8/8 tasks implemented at review time; one modified requirement and its 15 scenarios mapped to code and tests |
| Correctness | Persistence, image identity, eviction, retries, stale requests, layout moves, and cross-client updates covered |
| Coherence | Implementation follows the design; design and task evidence updated for server ownership fixes |

## Findings fixed

- **P2: a server switch could send a retained build's acknowledgement to the new server.**
  `useBotEngine` retained the old status when its client changed, and
  `BuildBanner` retained both progress and seen state while updating its send
  callback. Dismissing or retiring during this interval used the wrong
  connection; a stale request would be ignored and the original server would
  show the notice again. Status is now bound to its client, responses from
  retired connections are ignored, and banner state remounts per server.
  Deferred retirement therefore keeps the original server's callback.
- **P2: optimistic dismissals and mounted-banner counts were global by build ID.**
  Two servers carrying the same retained build ID could share hidden/in-flight
  state or suppress retirement. These stores are now scoped by server as well
  as build. Unit and browser tests exercise identical IDs on separate servers,
  delayed loading of the second status, and retirement through the original
  connection.
- **Coverage gap:** the service test did not exercise a failed durable save or
  all restricted claim types. It now verifies that failure publishes nothing,
  leaves the image unacknowledged, permits retry, and rejects project, session,
  capability, chat, execution, and MCP principals.

## Contract and security review

The tracker derives acknowledgement from the latest completed build's own
engine identity and fingerprint. It writes before changing memory, keeps 32
images, preserves them across builds and restart, and ignores stale or
non-completed build IDs. Running and failed notices remain visible. The client
sends immediately, hides optimistically, and retries on a later status without
polling or browser persistence. Existing events update other clients.

The command uses `assertBotAuthority` before reading its payload or changing
state. No image identity, filesystem path, project, or terminal session is
accepted from the caller. Renderer changes use the protocol client and add no
Node/Electron privileges. No remaining privilege or project/session boundary
violation was found in this change.

## Validation

- Workspace dependency builds passed.
- Targeted tracker, service, and acknowledgement tests: 21 passed.
- Protocol tests: 141 passed; client-core tests: 304 passed.
- Full Bots Chromium UI suite: 93 passed, including the server-switch regression.
- Renderer/Electron TypeScript check passed.
- Repository lint exited successfully with existing warnings; changed production
  files introduce no lint diagnostics. `git diff --check` passed.
- This change passes OpenSpec validation (with the requirement-length advisory).
  `openspec validate --all` reports 111 passing and 13 failing items; all failures
  name other open changes.
- Fresh desktop and phone screenshots were inspected for the ready notice and
  its absence after dismissal, cleared storage, and reload.
- Docker Electron E2E suite for Bots: 49 passed.

No remaining correctness or security findings in the checks completed above.

## Verification (after review)

| Dimension | Result |
| --- | --- |
| Completeness | 9/9 tasks; the one modified requirement is implemented |
| Correctness | All 15 scenarios have code and unit or end-to-end coverage |
| Coherence | Design followed |

One gap was found and fixed: only the build notice opened the build page,
although `bot-image-build-progress` requires the image controls to retain access
to the latest completed build, and the design relied on that. The engine card
now has **Build details**. Afterwards the Bots Electron E2E suite passed 49 of
49 in Docker, the Bots UI suite 110 of 110, and the type check passed.
