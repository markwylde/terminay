## Context

See proposal.md. An audit on 2026-08-08 recorded the gap in detail, and its
observations are retained here as investigation history:

- `https://app.terminay.com/` returned the legacy **Terminay Remote** manager,
  whose saved-sessions route showed an empty list with no primary paste or add
  affordance, and whose root document still owned an older QR and manual-link
  application.
- `https://web.terminay.com/` returned HTTP 421. Both public names resolved to
  the same pull zone, whose origin was still the legacy hosted
  signaling/session service rather than the checked-in static web image.
- `https://web.terminay.com/healthz` could return healthy while `/` was
  unusable, so origin health did not prove that the manager document and its
  assets were deployed.
- `src/remote/services/transport.ts` still treated `app.terminay.com` as the
  manager host while other components used a different canonical origin.
- `WebConnectionHost.migrateLegacyManagerRecord` and `sanitizeManagerProfiles`
  were pure sanitizers; their tests proved a safe DTO, not an executable
  cross-origin migration, redirect, import, or cleanup.
- The disconnected `src/web/main.tsx` form performed real pairing and
  enrollment, while `SharedConnectionsRouteBody` did not.
- The shared route also exposed low-level **Add server** fields for server id,
  name, and origin beside the pairing action, permitting a credential-less
  profile that could not connect.
- The runbook invoked `gh workflow run web-image.yml`, but the workflow had no
  `workflow_dispatch` trigger.
- The verifier expected `/healthz` to contain `{"ok":true}` while nginx returned
  plain text `ok`, and the verifier required a `Cross-Origin-Opener-Policy`
  header that the checked-in configuration did not emit — so a correctly
  deployed checked-in image would have failed its own verifier.

A later correction established `app.terminay.com` as the canonical manager. The
earlier `web.terminay.com` conclusion in the same audit was wrong; the historical
observations above are kept as they were recorded rather than rewritten.

This change owns the browser-manager pairing and delivery drift only. It does
not claim the broader server-bundle convergence work, and it does not weaken the
manager/session origin or credential boundaries to make migration easier.

## Goals / Non-Goals

Goals:
- Every connection-management entry point executes the same pairing transaction
  with the same failure semantics.
- No surface reports paired or saved before credentials and metadata are
  durably committed.
- Legacy migration moves sanitized metadata only, and proves it.
- Repository configuration and the public verifier agree with each other.

Non-Goals:
- Migrating origin-bound browser secrets across origins, which is not possible
  and must never be claimed.
- Replacing the session origin's ownership of device authentication.

## Decisions

- **Pairing is a host-level transaction, not a component behaviour.** One
  coordinator is shared by the modal, the route, empty-state actions, pasted
  links, and deep links, because the defect was precisely that one entry point
  had a real implementation and another had a lookalike.
- **Success is defined by durable commitment.** The connection counts as saved
  only after the exact-origin device key and reconnect material are committed
  and sanitized metadata is upserted. Pairing commits use reversible
  exact-origin vault and device-key operations: a metadata persistence failure
  restores the prior credential, and credential-conditional rollback cannot
  overwrite a newer concurrent pairing. A remote device record accepted before a
  local storage failure remains server-owned and requires the normal server
  revoke operation.
- **Re-pairing the same session origin updates in place.** The existing profile
  and credential are replaced atomically rather than creating a duplicate card
  or leaving the old grant active.
- **Advanced import is labelled as such.** Raw server-id and origin fields are
  not presented as equivalent to authenticated pairing, and a profile without
  reconnect credentials is labelled as needing pairing.
- **One canonical origin contract.** Manager-domain literals are replaced by a
  shared browser-safe contract used by transport classification, web-host
  composition, server allowlists, tests, and release tooling, and session
  subdomains are not misclassified as either manager.
- **Migration carries metadata only, once.** The handoff contains no pairing
  fragment, URL credential, reconnect grant, device key, PIN, terminal or
  workspace data, or arbitrary storage field, and is never placed in a query
  string, referrer, analytics event, or server log. The canonical manager
  consumes it once, upserts by stable identity and exact origin, and clears it
  from visible and history state. A failed import leaves the legacy record
  available for retry, and cleanup runs only after acknowledgement. Existing
  reconnect keys at session origins are untouched because neither manager origin
  owns them.
- **History is corrected, not rewritten.** Earlier task assertions that marked
  the executable redirect and migration complete on sanitizer unit tests alone
  were corrected in a new evidence note, preserving the old task files as
  history.
- **Health is not deployment evidence.** `/healthz` is reconciled to one exact
  media type and body across nginx, Docker health checks, the verifier, tests,
  and the runbook, and remains insufficient on its own. The verifier identifies
  the expected release revision or image digest through a non-secret artifact
  marker and rejects the legacy document, a signaling-service fallback,
  missing or stale hashed assets, redirects, host-routing failures, and an
  otherwise healthy wrong origin.
- **Hostname routing fails closed**, with each public name serving exactly one
  role and unknown hosts refused.

## Risks / Trade-offs

- A build-time integration test that starts the actual web image and runs the
  verifier against it is slower than asserting configuration source, but it is
  the only thing that catches drift between nginx and the verifier without
  public network access.
- Refusing to report success on metadata-only parsing makes some previously
  "successful" flows visibly fail. That is the intended correction.

## Migration Plan

The legacy manager is retired only after its bounded metadata-only migration
path works and is verified. A rollback procedure restores the prior immutable
image and routing without deleting legacy metadata or session-origin reconnect
credentials.

## Open Questions

Two aggregate pairing end-to-end journeys remained open at completion: the
repository does not prove every listed happy and adverse transition as a single
complete journey, although the individual pair, reconnect, revoke, expiry,
wrong-PIN, migration, multi-tab metadata, restart, rename, and forget behaviours
have substantial coverage. Public publication and verification also remained
unchecked, because the selected image had not been released and the deployed
canonical hostname still failed the verifier with HTTP 421.
