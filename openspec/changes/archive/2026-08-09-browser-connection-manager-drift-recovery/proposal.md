## Why

The checked-in browser shell contained a real pairing form, enrollment flow,
profile store, and reconnect vault, but the public origins did not expose that
journey. The shared connections route handed its pair-device value to callbacks
that only parsed the URL, created an offline profile, discarded the one-time
fragment, and could still announce success — so a user could be told a device
was paired when nothing had been enrolled and no reconnect material had been
stored. Legacy migration was likewise claimed on the strength of pure sanitizer
unit tests rather than an executable redirect or import.

## What Changes

- One host-level pairing coordinator serves the initial disconnected modal, the
  Connections route, empty-state actions, pasted links, and deep links. A UI
  component may collect input but may not reduce pairing to profile creation.
- **Add connection…** becomes the clear primary action in every empty or
  disconnected manager state and accepts the complete pairing URL directly.
- The one-time fragment is validated and consumed in memory and removed from the
  visible and history URL before device name and PIN or approval are collected.
- **BREAKING** A connection is reported saved only after exact-origin device key
  and reconnect material are durably committed and sanitized profile metadata
  has been upserted. Metadata-only parsing can no longer report pairing success.
- Manual metadata import becomes an explicitly advanced operation, and imported
  profiles without reconnect credentials are labelled as requiring pairing.
- Ad hoc manager-domain literals are replaced by one browser-safe canonical
  origin contract shared by transport classification, web-host composition,
  server allowlists, tests, and release tooling.
- A real bounded legacy page transfers only sanitized metadata to the canonical
  manager through a one-time handoff that carries no credentials, then completes
  a bounded cleanup and redirects future visits.
- The web image workflow gains a controlled manual dispatch, `/healthz` and
  security headers are reconciled across nginx, health checks, the verifier,
  tests, and the runbook, hostname routing fails closed, and the verifier
  identifies the expected release revision or image digest.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `connections-and-client-hosts`: one honest browser pair, save, and reconnect
  journey; a canonical manager origin contract; a bounded, credential-free
  legacy migration; and a deployment contract the verifier can actually prove.

## Impact

`apps/terminay-web` and the shared connections route, `packages/protocol`
manager-origin contract, `src/remote/services/transport.ts` classification, the
web host connection and vault code, `docker/nginx.web.conf`,
`.github/workflows/web-image.yml`, `verifyWebHostDeployment`, the web-host
deployment runbook, and the rollback procedure.

> Authority correction recorded during this change: `app.terminay.com` is the
> canonical connection manager. An earlier conclusion in the same audit named
> `web.terminay.com`; that was incorrect and the corrected authority is used by
> the governing specifications and the deployment runbook.
