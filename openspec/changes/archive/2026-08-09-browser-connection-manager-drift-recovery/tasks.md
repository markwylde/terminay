## 1. One canonical pair, save, and reconnect journey

- [x] 1.1 Extract one host-level pairing coordinator used by the disconnected
  modal, the Connections route, empty-state actions, pasted links, and supported
  deep links, and verify no UI component reduces pairing to profile creation
- [x] 1.2 Make **Add connection…** the primary action in every empty or
  disconnected manager state and verify it accepts a complete pairing URL
  directly, with QR scanning and metadata import as secondary alternatives
- [x] 1.3 Validate and consume the one-time fragment in memory, remove it from
  the visible and history URL, then collect device name and the configured PIN
  or approval before completing enrollment
- [x] 1.4 Report a connection as saved only after exact-origin device key and
  reconnect material are durably committed and sanitized metadata is upserted,
  verifying metadata-only parsing cannot report success
- [x] 1.5 Connect a newly paired profile immediately and verify re-pairing the
  same session origin updates the existing profile and credential atomically
  rather than creating a duplicate
- [x] 1.6 On reload or a later visit, show the remembered profile and reconnect
  by challenge and proof without the one-time link, and verify expired, missing,
  or revoked credentials keep the profile while asking for fresh pairing
- [x] 1.7 Keep manual metadata import an explicitly advanced operation and label
  imported profiles lacking reconnect credentials as requiring pairing
- [x] 1.8 Preserve distinct rename, disconnect, forget, and server-side revoke
  semantics, verifying forget removes browser-local profile and exact-origin
  reconnect material only after confirmation

## 2. Canonical and legacy origin convergence

- [x] 2.1 Replace ad hoc manager-domain literals with one browser-safe canonical
  origin contract shared by transport classification, web-host composition,
  server allowlists, tests, and release tooling, verifying session subdomains are
  not misclassified
- [x] 2.2 Implement a bounded legacy page that reads only the documented legacy
  non-secret profile record, validates and bounds every entry, and transfers only
  sanitized metadata through a one-time handoff
- [x] 2.3 Verify the handoff contains no pairing fragment, URL credential,
  reconnect grant, device key, PIN, terminal or workspace data, or arbitrary
  storage field, and never appears in a query string, referrer, analytics event,
  or server log
- [x] 2.4 Consume the handoff once in the canonical manager, upsert by stable
  identity and exact origin, clear it from visible and history state, and verify
  a failed import leaves the legacy record available for retry
- [x] 2.5 Complete the bounded legacy cleanup after successful import and
  redirect future visits, verifying session-origin reconnect keys are untouched
- [x] 2.6 Provide a no-profile redirect and a recovery path when storage is
  unavailable, malformed, oversized, or blocked, verifying no claim that
  cross-origin credentials were migrated
- [x] 2.7 Correct historical task assertions that marked the executable redirect
  and migration complete on sanitizer unit tests alone, recording the correction
  in a new evidence note while preserving the old task files as history

## 3. Build, publish, and public-origin contract

- [x] 3.1 Make `.github/workflows/web-image.yml` support controlled manual
  dispatch as well as the release trigger, and bind every image to an immutable
  digest, source revision, SBOM, and provenance record
- [x] 3.2 Reconcile `/healthz` across nginx, Docker health checks, the verifier,
  tests, and the runbook to one exact media type and body, and verify health
  alone remains insufficient deployment evidence
- [x] 3.3 Reconcile CSP, COOP, permissions policy, referrer policy, content-type
  protection, frame denial, and no-store entry documents across nginx and the
  verifier
- [x] 3.4 Add a build-time integration test that starts the actual web image and
  runs `verifyWebHostDeployment` against it, verifying it catches source-to-
  verifier drift without public network access
- [x] 3.5 Extend the verifier to identify the expected release revision or image
  digest through a non-secret artifact marker, and verify it rejects the legacy
  document, a signaling-service fallback, missing or stale hashed assets,
  redirects, host-routing failures, and an otherwise healthy wrong origin
- [x] 3.6 Make hostname routing fail closed so each public name serves exactly
  one role and unknown hosts are refused
- [x] 3.7 Add a rollback procedure that restores the prior immutable image and
  routing without deleting legacy metadata or session-origin reconnect
  credentials

## 4. Regression and end-to-end evidence

- [x] 4.1 Unit-test pairing URL validation, exact-origin upsert, atomic
  credential persistence, duplicate prevention, fresh-pairing recovery, and the
  guarantee that metadata-only parsing cannot report pairing success
- [x] 4.2 Unit-test legacy migration bounds, unsupported fields, malformed
  records, duplicate identities, cleanup only after acknowledgement, retry
  behaviour, and absence of secrets in handoff, history, and loggable surfaces
- [x] 4.3 Add renderer tests proving empty, disconnected, saved, unreachable,
  expired, revoked, and already-connected Connections views expose the same
  canonical add and pair flow with accessible labels and keyboard and touch
  behaviour
- [x] 4.4 Add a migration end-to-end test that begins at the real legacy origin
  with multiple sanitized saved profiles, lands on the canonical origin, clears
  the handoff, preserves session-origin credentials, and requests fresh pairing
  where credentials are absent
- [x] 4.5 Verify the canonical pairing path through
  `scripts/task39-pairing-coordinator.test.mjs`, the web-host connection tests,
  and the Docker renderer suite
- [x] 4.6 Verify the manager-origin contract and bounded migration protocol
  through `packages/protocol/test/manager-origins.test.mjs`,
  `apps/terminay-web/test/legacy-migration.test.mjs`, and
  `e2e/web-legacy-manager-migration.spec.ts`
- [x] 4.7 Verify `scripts/web-image-integration.test.mjs` builds and starts the
  production image and runs the release verifier against its canonical and
  legacy Host routes
- [x] 4.8 Run the full Docker-isolated browser and Electron suite, recording 216
  passing tests with seven intentional skips under
  `.docker-cache/e2e/20260808T233508Z-14908` and 20 focused state and adverse
  tests under `.docker-cache/e2e/20260808T233358Z-14496`
