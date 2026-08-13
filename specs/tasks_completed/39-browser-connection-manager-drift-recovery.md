# Browser connection manager drift recovery

## Goal

Make the public browser journey match the canonical connection-host contract:
a user can paste a pairing link from every connection-management entry point,
complete enrollment, reconnect immediately, and return later through a saved
connection without reusing the one-time link. Retire the legacy public manager
only after its bounded, metadata-only migration path is working and verified.

> Authority correction (2026-08-09): `app.terminay.com` is the canonical
> connection manager. The earlier `web.terminay.com` conclusion in this audit
> was incorrect. Historical observations below are retained as investigation
> history; the governing feature specifications and deployment runbook use the
> corrected authority.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Remote access](../features/remote-access.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Browser host and cross-version convergence](../tasks/29-browser-host-and-cross-version-convergence.md)
- [WebRTC transport recovery acceptance](../tasks/43-webrtc-transport-recovery-acceptance.md)
- [Web connection host deployment](../operations/web-host-deployment.md)

## Current gap

The repository specifies `https://web.terminay.com` as the stable browser
connection host and `https://app.terminay.com` as a legacy migration source.
The checked-in browser shell contains a real pairing form, enrollment flow,
profile store, and reconnect vault, but the public origins do not expose that
journey as specified.

An audit on 2026-08-08 found:

- `https://app.terminay.com/` returns the legacy **Terminay Remote** manager.
  Its saved-sessions route presents an empty list without the expected primary
  paste/add affordance. The root document still owns an older QR/manual-link
  application rather than redirecting to the canonical host.
- `https://web.terminay.com/` returns HTTP 421. Both public names resolve to the
  same Bunny pull zone, whose origin is still the legacy hosted
  signaling/session service rather than the checked-in static web image.
- `https://web.terminay.com/healthz` can return a healthy response even while
  `/` is unusable. CDN/origin health therefore does not prove that the manager
  document and its assets are deployed.
- `src/remote/services/transport.ts` still treats `app.terminay.com` as the
  manager host, contradicting the canonical origin used by `@terminay/web`,
  server configuration, feature specs, and readiness checks.
- `WebConnectionHost.migrateLegacyManagerRecord` and
  `sanitizeManagerProfiles` are pure sanitizers. Their tests prove a safe DTO,
  not an executable cross-origin migration, redirect, import, or cleanup. Task
  18 and Task 19 therefore claim more completion than their evidence supports.
- The disconnected `src/web/main.tsx` form performs real pairing and
  enrollment. In contrast, `SharedConnectionsRouteBody` hands its **Pair
  device** value to callbacks that call only `consumePairingUrl`, create an
  offline profile, discard the one-time fragment, and may announce success.
  This path neither enrolls the device nor persists reconnect material.
- The shared management route also exposes low-level **Add server** fields for
  server id, name, and origin beside the pairing action. On an empty host this
  obscures the normal user journey and permits a credential-less profile that
  cannot satisfy the expected connect-and-save outcome.
- The deployment runbook invokes `gh workflow run web-image.yml`, but the
  workflow has no `workflow_dispatch` trigger. It publishes only for version
  tags, so the documented manual deployment sequence cannot run as written.
- The public verifier expects `/healthz` to contain `{"ok":true}`, while
  `docker/nginx.web.conf` returns plain text `ok`. The runbook repeats the JSON
  expectation. A correctly deployed checked-in image would fail its own
  verifier.
- The verifier requires `Cross-Origin-Opener-Policy: same-origin`, but the
  checked-in web nginx configuration does not emit that header. Local image
  tests do not assert the verifier and nginx contracts against each other.
- Existing local readiness, migration, and image tests explicitly disclaim
  public deployment. No release gate proves the canonical hostname, legacy
  redirect, real built asset identity, pairing entry point, or saved reconnect
  in the deployed artifact.

This task owns the browser-manager pairing and delivery drift only. It does not
claim the broader server-bundle convergence work in Task 29, and it must not
weaken the manager/session origin or credential boundaries to make migration
easier.

## Implementation slices

### One canonical pair, save, and reconnect journey

- [x] Extract one host-level pairing coordinator used by the initial
  disconnected modal, the Connections route, empty-state actions, pasted
  links, and supported deep links. A UI component may collect input, but it
  must not reduce pairing to profile creation.
- [x] Make **Add connection…** the clear primary action in every empty or
  disconnected manager state. It accepts the complete pairing URL directly;
  QR scanning and metadata import remain secondary alternatives where
  supported.
- [x] Validate and consume the one-time fragment in memory, remove it from the
  visible/history URL, then collect device name and the configured PIN or
  approval before completing enrollment.
- [x] Treat the connection as saved only after the exact-origin device key and
  reconnect material are durably committed and sanitized profile metadata has
  been upserted. Never display paired/saved success for metadata-only parsing.
- [x] Connect the newly paired profile immediately. Re-pairing the same exact
  session origin updates the existing profile and credential atomically rather
  than creating a duplicate card or leaving the old grant active.
- [x] On reload or a later visit, show the remembered profile and reconnect by
  challenge/proof without requesting or retaining the one-time pairing URL.
  Expired, missing, or revoked credentials keep the non-secret profile and ask
  for a fresh pairing link until the user explicitly forgets it.
- [x] Keep manual metadata import as an explicitly advanced operation. Do not
  present raw server-id/origin fields as equivalent to authenticated pairing,
  and label imported profiles that lack reconnect credentials as requiring
  pairing.
- [x] Preserve distinct rename, disconnect, forget, and server-side revoke
  semantics; forgetting removes browser-local profile and exact-origin
  reconnect material only after confirmation.

### Canonical and legacy origin convergence

- [x] Replace ad hoc manager-domain literals with one browser-safe canonical
  origin contract shared by transport classification, web-host composition,
  server allowlists, tests, and release tooling. Session subdomains must not be
  misclassified as either manager.
- [x] Implement an actual bounded legacy page at `app.terminay.com`. It reads
  only the documented legacy non-secret profile record at that origin,
  validates and bounds every entry, and transfers only sanitized metadata to
  `web.terminay.com` through a specified one-time migration handoff.
- [x] Ensure the migration handoff contains no pairing fragment, URL
  credentials, reconnect grant, device key, PIN, terminal/workspace data, or
  arbitrary storage fields. Do not place migration data in a query string,
  referrer, analytics event, or server log.
- [x] Make the canonical manager consume the handoff once, upsert profiles by
  stable identity/exact origin, clear the handoff from visible/history state,
  and report profiles without origin-bound credentials as needing fresh
  pairing. A failed import leaves the legacy record available for retry.
- [x] After successful import, complete the bounded legacy cleanup policy and
  redirect future visits to the canonical manager. Existing reconnect keys at
  session origins remain untouched because neither manager origin owns them.
- [x] Provide a no-profile redirect and an understandable recovery path when
  storage is unavailable, malformed, oversized, or blocked. Never silently
  claim that cross-origin browser credentials were migrated.
- [x] Update historical task assertions or evidence wording that currently
  marks the executable redirect/migration complete based only on sanitizer
  unit tests. Preserve the old task files as history; record corrections in a
  new evidence note rather than rewriting checked history as if it happened.

### Build, publish, and public-origin contract

- [x] Make `.github/workflows/web-image.yml` support the documented controlled
  manual dispatch as well as the intended release trigger. Bind every image to
  an immutable digest, source revision, SBOM, and provenance record.
- [x] Reconcile `/healthz` across nginx, Docker health checks, the deployment
  verifier, tests, and runbook. One exact media type and body must be asserted
  everywhere; health alone must remain insufficient deployment evidence.
- [x] Reconcile security headers across nginx and the public verifier,
  including CSP, COOP, permissions policy, referrer policy, content-type
  protection, frame denial, and no-store entry documents.
- [x] Add a build-time integration test that starts the actual web image and
  runs `verifyWebHostDeployment` against it. This must catch contract drift
  between source configuration and the verifier without public network access.
- [x] Extend the verifier to identify the expected release revision or image
  digest through a non-secret artifact marker. Reject the legacy **Terminay
  Remote** document, a signaling-service fallback, missing/stale hashed assets,
  redirects, host-routing failures, and an otherwise healthy wrong origin.
- [x] Make hostname routing fail closed: `app.terminay.com` serves only the
  canonical static manager, `web.terminay.com` serves only the bounded migration
  redirect, and session/signaling hosts retain their separate authority.
- [x] Add an explicit rollback procedure that restores the prior immutable
  image/routing without deleting legacy metadata or session-origin reconnect
  credentials.

### Regression and end-to-end evidence

- [x] Unit-test pairing URL validation, exact-origin upsert, atomic credential
  persistence, duplicate prevention, fresh-pairing recovery, and the guarantee
  that metadata-only parsing cannot report pairing success.
- [x] Unit-test legacy migration bounds, unsupported fields, malformed records,
  duplicate identities, cleanup only after acknowledgement, retry behavior,
  and absence of secrets in handoff/history/loggable surfaces.
- [x] Add renderer tests proving that empty, disconnected, saved, unreachable,
  expired, revoked, and already-connected Connections views all expose the same
  canonical add/pair flow with accessible labels and keyboard/touch behavior.
- [x] Add a migration E2E that begins at the real legacy origin with multiple
  sanitized saved profiles, lands on the canonical origin, clears the handoff,
  preserves session-origin credentials, and clearly requests fresh pairing
  where credentials are absent.

## Implementation evidence

- The canonical pairing path is exercised by
  `scripts/task39-pairing-coordinator.test.mjs`, the web-host connection tests,
  and the Docker renderer suite. Metadata import remains an explicitly advanced
  operation and cannot report pairing success.
- Browser-local pairing commits now use reversible exact-origin vault and
  device-key operations. Metadata persistence failures restore the prior
  credential, and credential-conditional rollback cannot overwrite a newer
  concurrent pairing. A remote device record accepted before a local storage
  failure remains server-owned and requires the normal server revoke operation.
- The exact manager-origin contract and bounded migration protocol are covered
  by `packages/protocol/test/manager-origins.test.mjs`,
  `apps/terminay-web/test/legacy-migration.test.mjs`, and
  `e2e/web-legacy-manager-migration.spec.ts`. The historical evidence correction
  is recorded in
  `specs/decisions/evidence/task39-browser-manager-drift-correction.md`.
- `scripts/web-image-integration.test.mjs` builds and starts the production
  image, then runs the release verifier against its canonical and legacy Host
  routes. The workflow, release marker, health response, headers, rollback
  procedure, and unknown-host rejection are also guarded by source tests.
- The final Docker-isolated browser/Electron run passed 216 tests with seven
  intentional skips; artifacts are under
  `.docker-cache/e2e/20260808T233508Z-14908`. Focused state/adverse coverage
  passed 20 tests under `.docker-cache/e2e/20260808T233358Z-14496`.
- The two aggregate pairing E2E bullets remain open because the repository does
  not yet prove every listed happy/adverse transition as the requested complete
  journeys, even though the individual pair/reconnect/revoke, expiry, wrong-PIN,
  migration, multi-tab metadata, restart, rename, and forget behaviors have
  substantial coverage.
- Public publication and verification remain unchecked because the selected
  image has not been released to Bunny and the currently deployed canonical
  hostname still fails the verifier with HTTP 421.

## Acceptance checks

- A first-time visitor sees an obvious **Add connection…** control and can paste
  the pairing URL without discovering a hidden details panel or inventing
  server metadata.
- Completing device enrollment connects immediately and creates one remembered
  connection. Closing and reopening the browser reconnects that connection
  without the original link.
- The initial modal, empty saved-connections page, connected Connections route,
  and deep-link entry all execute the same pairing transaction and failure
  semantics.
- No UI reports paired or saved until both protected reconnect material and
  sanitized metadata have been durably committed.
- `app.terminay.com` serves the verified canonical manager and its hashed
  assets with the required security headers; it never returns the signaling
  service's HTTP 421 host-boundary response.
- `web.terminay.com` no longer serves an independently evolving manager. It
  performs the bounded metadata migration/redirect or a safe no-data redirect.
- Legacy migration never claims to copy origin-bound secrets. Pairing URLs,
  fragments, keys, grants, PINs, and application data are absent from manager
  storage, migration handoffs, browser history, logs, and release evidence.
- The deployment command in the runbook is executable, the local image passes
  the same verifier used against production, and public evidence identifies
  the exact immutable image and source revision.
- All browser and Electron end-to-end coverage is run through
  `npm run test:e2e` in Docker.

## Definition of done

The canonical public browser host provides one honest pair/save/reconnect
journey from every connection-management state, the legacy origin performs a
tested metadata-only migration and redirect, repository and deployment
contracts agree, and immutable local plus public evidence proves the exact
released manager rather than a healthy but unrelated service.
