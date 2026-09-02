## Why

Puzed Platform support needed to exist as an installable official extension
rather than Terminay-internal code, with Platform profiles, VM inventory,
lifecycle, durable events and jobs, and a tested SSH composition contract,
before any VM provisioning journey could be built on it.

## What Changes

- Publish `terminay-plugin-puzed` as a separate official npm package that
  depends on the SSH extension and imports no internal Terminay or Puzed UI.
- Add an HTTPS exact-origin bounded API client with a vault-held bearer key,
  `/me` organization and scope validation, safe URL, redirect, and error
  policy, and auditing.
- Generate the provider contract from the current Go-authored OpenAPI document
  instead of hand-written provider DTOs.
- Implement paginated `system:Terminay`-filtered VM inventory plus image,
  worker, bridge, settings, and job discovery, with capability and disabled
  reasons and exact Open in Puzed routes.
- Share one authenticated resumable SSE stream per profile organization,
  process payload-free invalidations, and refetch exact resources without
  polling.
- Implement idempotent start, stop, resume, reboot, and delete with revisions,
  operation conflicts, disk disposition, progress, and independent management
  status.
- Model existing-VM binding: stable Platform and machine identity, observed and
  static address with overrides, retained SSH key binding, stopped
  start-and-open, provisioning resume, and stale or deleted state.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `puzed-project-environments`: the extension package boundary, API transport
  and scope validation, tagged VM inventory, lifecycle management, shared event
  stream, and opening an existing Terminay VM.

## Impact

The new `terminay-plugin-puzed` package and its OpenAPI-generated client, the
vault-held Platform profile secrets, the extension host's provider
registration, and the SSH extension dependency descriptor consumed by composed
environments.
